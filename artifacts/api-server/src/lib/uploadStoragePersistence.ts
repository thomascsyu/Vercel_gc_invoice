import { readFileSync } from "node:fs";
import path from "node:path";

/** Host directory bind-mounted into the container (Docker `-v …:/data`). */
export const UPLOAD_VOLUME_MOUNT = "/data";
export const DEFAULT_VOLUME_PUBLIC_UPLOAD_DIR = "/data/public-objects";
export const DEFAULT_VOLUME_PRIVATE_UPLOAD_DIR = "/data/private-objects";
export const DEFAULT_DEV_PUBLIC_UPLOAD_DIR = ".local/public-objects";
export const DEFAULT_DEV_PRIVATE_UPLOAD_DIR = ".local/private-objects";
/** Vercel Functions can only write to /tmp, and it is wiped between instances. */
export const SERVERLESS_PUBLIC_UPLOAD_DIR = "/tmp/public-objects";
export const SERVERLESS_PRIVATE_UPLOAD_DIR = "/tmp/private-objects";

const EPHEMERAL_FS = new Set([
  "overlay",
  "overlay2",
  "tmpfs",
  "aufs",
  "devtmpfs",
  "ramfs",
  "squashfs",
]);

/** Filesystems that keep files across reboot on an Ubuntu host (including data disks). */
const DURABLE_HOST_FS = new Set([
  "ext2",
  "ext3",
  "ext4",
  "xfs",
  "btrfs",
  "zfs",
  "bcachefs",
  "f2fs",
]);

export type ProcMount = { mountPoint: string; fstype: string };

export type UploadStorageBackend = "gcs" | "local-volume" | "local-ephemeral";

export type UploadStorageStatus = {
  persistent: boolean;
  backend: UploadStorageBackend;
};

export function envFlagEnabled(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function parseProcMounts(contents: string): ProcMount[] {
  const mounts: ProcMount[] = [];
  for (const line of contents.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    mounts.push({
      mountPoint: parts[1]!.replace(/\\040/g, " "),
      fstype: parts[2]!,
    });
  }
  mounts.sort((a, b) => b.mountPoint.length - a.mountPoint.length);
  return mounts;
}

export function readProcMounts(): ProcMount[] {
  try {
    return parseProcMounts(readFileSync("/proc/self/mounts", "utf8"));
  } catch {
    return [];
  }
}

function mountForPath(absPath: string, mounts: ProcMount[]): ProcMount | undefined {
  const resolved = path.resolve(absPath);
  return mounts.find((m) => {
    if (m.mountPoint === "/") return resolved.startsWith("/");
    return resolved === m.mountPoint || resolved.startsWith(`${m.mountPoint}/`);
  });
}

function isTempPath(resolved: string, mountPoint: string): boolean {
  if (mountPoint === "/tmp" || mountPoint === "/var/tmp") return true;
  if (resolved === "/tmp" || resolved.startsWith("/tmp/")) return true;
  if (resolved === "/var/tmp" || resolved.startsWith("/var/tmp/")) return true;
  return false;
}

/**
 * True when `absPath` lives on a dedicated mount (not the container or host
 * root `/`, and not overlay/tmpfs). That is a Docker bind mount or a separate
 * data disk mounted at `/data`.
 */
export function isPathOnPersistentVolume(absPath: string, mounts: ProcMount[]): boolean {
  const resolved = path.resolve(absPath);
  const match = mountForPath(resolved, mounts);
  if (!match) return false;
  if (match.mountPoint === "/") return false;
  if (isTempPath(resolved, match.mountPoint)) return false;
  if (EPHEMERAL_FS.has(match.fstype)) return false;
  return true;
}

/**
 * True when `absPath` sits on the machine root filesystem and that filesystem
 * is a real disk (ext4/xfs on Ubuntu 24.04). Container overlay root stays
 * ephemeral. This does not by itself switch the default upload directory to
 * `/data` — only a dedicated mount or `PERSIST_LOCAL_UPLOADS` does that.
 */
export function isPathOnDurableHostDisk(absPath: string, mounts: ProcMount[]): boolean {
  const resolved = path.resolve(absPath);
  const match = mountForPath(resolved, mounts);
  if (!match || match.mountPoint !== "/") return false;
  if (isTempPath(resolved, match.mountPoint)) return false;
  if (EPHEMERAL_FS.has(match.fstype)) return false;
  return DURABLE_HOST_FS.has(match.fstype);
}

function uploadsTargetDataVolume(absPath: string): boolean {
  const resolved = path.resolve(absPath);
  return resolved === UPLOAD_VOLUME_MOUNT || resolved.startsWith(`${UPLOAD_VOLUME_MOUNT}/`);
}

export function isUploadVolumeMounted(mounts: ProcMount[] = readProcMounts()): boolean {
  return (
    isPathOnPersistentVolume(UPLOAD_VOLUME_MOUNT, mounts) ||
    isPathOnPersistentVolume(DEFAULT_VOLUME_PUBLIC_UPLOAD_DIR, mounts)
  );
}

export function resolveLocalPublicUploadRoot(): string {
  const explicit = process.env.LOCAL_PUBLIC_UPLOAD_DIR?.trim();
  if (explicit) return explicit;
  if (envFlagEnabled("PERSIST_LOCAL_UPLOADS") || isUploadVolumeMounted()) {
    return DEFAULT_VOLUME_PUBLIC_UPLOAD_DIR;
  }
  if (process.env.VERCEL) return SERVERLESS_PUBLIC_UPLOAD_DIR;
  return DEFAULT_DEV_PUBLIC_UPLOAD_DIR;
}

export function resolveLocalPrivateUploadRoot(): string {
  const explicit = process.env.LOCAL_PRIVATE_UPLOAD_DIR?.trim();
  if (explicit) return explicit;
  if (envFlagEnabled("PERSIST_LOCAL_UPLOADS") || isUploadVolumeMounted()) {
    return DEFAULT_VOLUME_PRIVATE_UPLOAD_DIR;
  }
  if (process.env.VERCEL) return SERVERLESS_PRIVATE_UPLOAD_DIR;
  return DEFAULT_DEV_PRIVATE_UPLOAD_DIR;
}

export function getUploadStorageStatus(
  gcsSearchPathCount: number,
  mounts: ProcMount[] = readProcMounts(),
): UploadStorageStatus {
  if (gcsSearchPathCount > 0) {
    return { persistent: true, backend: "gcs" };
  }
  if (envFlagEnabled("PERSIST_LOCAL_UPLOADS")) {
    const publicRoot = path.resolve(process.cwd(), resolveLocalPublicUploadRoot());
    if (uploadsTargetDataVolume(publicRoot)) {
      const dataMounted =
        isPathOnPersistentVolume(publicRoot, mounts) ||
        isPathOnPersistentVolume(UPLOAD_VOLUME_MOUNT, mounts);
      if (!dataMounted) {
        return { persistent: false, backend: "local-ephemeral" };
      }
    }
    return { persistent: true, backend: "local-volume" };
  }
  const publicRoot = path.resolve(process.cwd(), resolveLocalPublicUploadRoot());
  if (isPathOnPersistentVolume(publicRoot, mounts) || isPathOnDurableHostDisk(publicRoot, mounts)) {
    return { persistent: true, backend: "local-volume" };
  }
  return { persistent: false, backend: "local-ephemeral" };
}

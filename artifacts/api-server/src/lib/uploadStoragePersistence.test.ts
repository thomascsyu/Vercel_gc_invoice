import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  parseProcMounts,
  isPathOnPersistentVolume,
  isPathOnDurableHostDisk,
  isUploadVolumeMounted,
  resolveLocalPublicUploadRoot,
  resolveLocalPrivateUploadRoot,
  getUploadStorageStatus,
  DEFAULT_DEV_PUBLIC_UPLOAD_DIR,
  DEFAULT_VOLUME_PUBLIC_UPLOAD_DIR,
  DEFAULT_VOLUME_PRIVATE_UPLOAD_DIR,
} from "./uploadStoragePersistence.js";

const overlayRootMounts = parseProcMounts(`
overlay / overlay rw 0 0
tmpfs /dev tmpfs rw 0 0
`);

const dataDiskMounts = parseProcMounts(`
overlay / overlay rw 0 0
/dev/sda /data ext4 rw 0 0
`);

describe("uploadStoragePersistence", () => {
  const keys = [
    "LOCAL_PUBLIC_UPLOAD_DIR",
    "LOCAL_PRIVATE_UPLOAD_DIR",
    "PERSIST_LOCAL_UPLOADS",
    "PUBLIC_OBJECT_SEARCH_PATHS",
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of keys) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("treats overlay root as ephemeral and /data ext4 as persistent", () => {
    assert.equal(isPathOnPersistentVolume("/app/.local/public-objects", overlayRootMounts), false);
    assert.equal(isPathOnPersistentVolume("/data/public-objects", overlayRootMounts), false);
    assert.equal(isPathOnPersistentVolume("/data/public-objects", dataDiskMounts), true);
    assert.equal(isPathOnPersistentVolume("/data", dataDiskMounts), true);
    assert.equal(isUploadVolumeMounted(dataDiskMounts), true);
    assert.equal(isUploadVolumeMounted(overlayRootMounts), false);
  });

  it("treats an Ubuntu ext4 root as durable and a container overlay root as ephemeral", () => {
    const ubuntuRoot = parseProcMounts("/dev/vda2 / ext4 rw 0 0\n");
    const uploadPath = "/var/lib/gc-inv/uploads/public-objects";
    assert.equal(isPathOnDurableHostDisk(uploadPath, ubuntuRoot), true);
    assert.equal(isPathOnPersistentVolume(uploadPath, ubuntuRoot), false);
    assert.equal(isUploadVolumeMounted(ubuntuRoot), false);
    assert.equal(isPathOnDurableHostDisk("/app/.local/public-objects", overlayRootMounts), false);
    assert.equal(isPathOnDurableHostDisk(uploadPath, dataDiskMounts), false);
  });

  it("reports host-disk uploads as persistent and overlay uploads as ephemeral", () => {
    delete process.env.PERSIST_LOCAL_UPLOADS;
    const uploadPath = "/var/lib/gc-inv/uploads/public-objects";
    process.env.LOCAL_PUBLIC_UPLOAD_DIR = uploadPath;
    const ubuntuRoot = parseProcMounts("/dev/vda2 / ext4 rw 0 0\n");
    assert.deepEqual(getUploadStorageStatus(0, ubuntuRoot), {
      persistent: true,
      backend: "local-volume",
    });
    assert.deepEqual(getUploadStorageStatus(0, overlayRootMounts), {
      persistent: false,
      backend: "local-ephemeral",
    });
  });

  it("ignores tmpfs mounts even when not at /", () => {
    const mounts = parseProcMounts("tmpfs /data tmpfs rw 0 0\noverlay / overlay rw 0 0\n");
    assert.equal(isPathOnPersistentVolume("/data/public-objects", mounts), false);
  });

  it("never treats /tmp as a persistent volume", () => {
    const mounts = parseProcMounts("overlay / overlay rw 0 0\n/dev/sdb /tmp ext4 rw 0 0\n");
    assert.equal(isPathOnPersistentVolume("/tmp/branding-test", mounts), false);
  });

  it("uses .local defaults unless a volume or PERSIST_LOCAL_UPLOADS is set", () => {
    delete process.env.LOCAL_PUBLIC_UPLOAD_DIR;
    delete process.env.LOCAL_PRIVATE_UPLOAD_DIR;
    delete process.env.PERSIST_LOCAL_UPLOADS;
    assert.equal(resolveLocalPublicUploadRoot(), DEFAULT_DEV_PUBLIC_UPLOAD_DIR);
  });

  it("honours explicit LOCAL_* dirs", () => {
    process.env.LOCAL_PUBLIC_UPLOAD_DIR = "/mnt/uploads/public";
    process.env.LOCAL_PRIVATE_UPLOAD_DIR = "/mnt/uploads/private";
    assert.equal(resolveLocalPublicUploadRoot(), "/mnt/uploads/public");
    assert.equal(resolveLocalPrivateUploadRoot(), "/mnt/uploads/private");
  });

  it("writes under /data when PERSIST_LOCAL_UPLOADS is set", () => {
    delete process.env.LOCAL_PUBLIC_UPLOAD_DIR;
    delete process.env.LOCAL_PRIVATE_UPLOAD_DIR;
    process.env.PERSIST_LOCAL_UPLOADS = "1";
    assert.equal(resolveLocalPublicUploadRoot(), DEFAULT_VOLUME_PUBLIC_UPLOAD_DIR);
    assert.equal(resolveLocalPrivateUploadRoot(), DEFAULT_VOLUME_PRIVATE_UPLOAD_DIR);
  });

  it("reports gcs as persistent regardless of local disk", () => {
    delete process.env.PERSIST_LOCAL_UPLOADS;
    assert.deepEqual(getUploadStorageStatus(1), { persistent: true, backend: "gcs" });
  });

  it("reports local-volume when PERSIST_LOCAL_UPLOADS is set and /data is mounted", () => {
    process.env.PERSIST_LOCAL_UPLOADS = "true";
    assert.deepEqual(getUploadStorageStatus(0, dataDiskMounts), {
      persistent: true,
      backend: "local-volume",
    });
  });

  it("reports ephemeral when PERSIST_LOCAL_UPLOADS is set but /data is not mounted", () => {
    process.env.PERSIST_LOCAL_UPLOADS = "1";
    delete process.env.LOCAL_PUBLIC_UPLOAD_DIR;
    assert.deepEqual(getUploadStorageStatus(0, overlayRootMounts), {
      persistent: false,
      backend: "local-ephemeral",
    });
  });

  it("reports local-ephemeral for a tmpdir-style path without a volume flag", () => {
    delete process.env.PERSIST_LOCAL_UPLOADS;
    process.env.LOCAL_PUBLIC_UPLOAD_DIR = path.join("/tmp", "branding-test");
    const status = getUploadStorageStatus(0);
    assert.equal(status.backend, "local-ephemeral");
    assert.equal(status.persistent, false);
  });
});

import { Storage, File } from "@google-cloud/storage";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";
import { isManagedBrandingStoragePath } from "./brandingImageUrl";
import {
  getUploadStorageStatus as computeUploadStorageStatus,
  resolveLocalPrivateUploadRoot,
  resolveLocalPublicUploadRoot,
  type UploadStorageStatus,
} from "./uploadStoragePersistence";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

function getObjectStorageClient(): Storage {
  const isReplit =
    Boolean(process.env["REPL_ID"]) ||
    Boolean(process.env["REPLIT_DEPLOYMENT"]) ||
    Boolean(process.env["REPLIT_DOMAINS"]);
  if (isReplit) {
    return new Storage({
      credentials: {
        audience: "replit",
        subject_token_type: "access_token",
        token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
        type: "external_account",
        credential_source: {
          url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
          format: {
            type: "json",
            subject_token_field_name: "access_token",
          },
        },
        universe_domain: "googleapis.com",
      },
      projectId: "",
    });
  }

  // Default to Google ADC (service account JSON via GOOGLE_APPLICATION_CREDENTIALS,
  // GKE/GCE metadata, workload identity, etc.). This is the expected mode for
  // Docker on an Ubuntu VM, or any host with Application Default Credentials.
  return new Storage();
}

export const objectStorageClient = getObjectStorageClient();

/** Stand-in for GCS `File` when private objects are stored on local disk (dev). */
export class LocalPrivateFile {
  readonly absolutePath: string;
  readonly contentType: string;

  constructor(absolutePath: string) {
    this.absolutePath = absolutePath;
    this.contentType = contentTypeFromPublicFilename(absolutePath);
  }

  async delete(): Promise<void> {
    try {
      await unlink(this.absolutePath);
    } catch {
      /* missing file is fine */
    }
  }
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export type PublicObjectSource =
  | { kind: "gcs"; file: File }
  | { kind: "local"; absolutePath: string; contentType: string };

function localPublicUploadRoot(): string {
  return resolveLocalPublicUploadRoot();
}

function localPrivateUploadRoot(): string {
  return resolveLocalPrivateUploadRoot();
}

function sanitizePublicObjectRelativePath(filePath: string): string {
  return filePath
    .split(/[/\\]+/)
    .filter((seg) => seg.length > 0 && seg !== "." && seg !== "..")
    .join("/");
}

function contentTypeFromPublicFilename(relPath: string): string {
  const ext = path.extname(relPath).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".json": "application/json",
  };
  return map[ext] || "application/octet-stream";
}

export class ObjectStorageService {
  constructor() {}

  /** GCS prefixes, a host directory under `/data`, or ephemeral container disk. */
  getUploadStorageStatus(): UploadStorageStatus {
    return computeUploadStorageStatus(this.getConfiguredPublicObjectSearchPaths().length);
  }

  /** When empty, public logo/uploads use LOCAL_PUBLIC_UPLOAD_DIR instead of GCS (local disk or `/data`). */
  getConfiguredPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    return Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
      )
    );
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<PublicObjectSource | null> {
    const safeRel = sanitizePublicObjectRelativePath(filePath);
    if (!safeRel) {
      return null;
    }

    const gcsPaths = this.getConfiguredPublicObjectSearchPaths();
    for (const searchPath of gcsPaths) {
      const fullPath = `${searchPath}/${safeRel}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return { kind: "gcs", file };
      }
    }

    {
      const root = path.resolve(process.cwd(), localPublicUploadRoot());
      const abs = path.join(root, safeRel);
      try {
        const st = await stat(abs);
        if (st.isFile()) {
          return {
            kind: "local",
            absolutePath: abs,
            contentType: contentTypeFromPublicFilename(safeRel),
          };
        }
      } catch {
        /* missing */
      }
    }

    return null;
  }

  async downloadObject(file: File | LocalPrivateFile, cacheTtlSec: number = 3600): Promise<Response> {
    if (file instanceof LocalPrivateFile) {
      const st = await stat(file.absolutePath);
      const nodeStream = createReadStream(file.absolutePath);
      const webStream = Readable.toWeb(nodeStream) as ReadableStream;
      const headers: Record<string, string> = {
        "Content-Type": file.contentType,
        "Cache-Control": `private, max-age=${cacheTtlSec}`,
      };
      if (st.size) {
        headers["Content-Length"] = String(st.size);
      }
      return new Response(webStream, { headers });
    }
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === "public";

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async downloadPublicObject(source: PublicObjectSource, cacheTtlSec: number = 3600): Promise<Response> {
    if (source.kind === "gcs") {
      return this.downloadObject(source.file, cacheTtlSec);
    }
    const st = await stat(source.absolutePath);
    const nodeStream = createReadStream(source.absolutePath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    const headers: Record<string, string> = {
      "Content-Type": source.contentType,
      "Cache-Control": `public, max-age=${cacheTtlSec}`,
    };
    if (st.size) {
      headers["Content-Length"] = String(st.size);
    }
    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<File | LocalPrivateFile> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    const privateObjectDir = process.env.PRIVATE_OBJECT_DIR?.trim();
    if (!privateObjectDir) {
      const root = path.resolve(process.cwd(), localPrivateUploadRoot());
      const abs = path.join(root, entityId);
      try {
        const st = await stat(abs);
        if (!st.isFile()) {
          throw new ObjectNotFoundError();
        }
      } catch {
        throw new ObjectNotFoundError();
      }
      return new LocalPrivateFile(abs);
    }

    let entityDir = privateObjectDir;
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    if (objectFile instanceof LocalPrivateFile) {
      return normalizedPath;
    }
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  /**
   * Store a private object (not served via public-objects). Returns an app path
   * suitable for `getObjectEntityFile` (e.g. `/objects/payment-receipts/...`).
   */
  async uploadPrivateEntity({
    relativePath,
    contentType,
    body,
  }: {
    relativePath: string;
    contentType: string;
    body: Buffer;
  }): Promise<{ objectPath: string }> {
    const safeRel = sanitizePublicObjectRelativePath(relativePath);
    if (!safeRel) {
      throw new Error("Invalid private upload path");
    }

    const privateObjectDir = process.env.PRIVATE_OBJECT_DIR?.trim();
    if (!privateObjectDir) {
      const root = path.resolve(process.cwd(), localPrivateUploadRoot());
      const abs = path.join(root, safeRel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, body);
      return { objectPath: `/objects/${safeRel}` };
    }

    let entityDir = privateObjectDir;
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${safeRel}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    await file.save(body, { contentType, resumable: false });
    return { objectPath: `/objects/${safeRel}` };
  }

  async uploadPublicAsset({
    folder,
    filename,
    contentType,
    body,
  }: {
    folder: string;
    filename: string;
    contentType: string;
    body: Buffer;
  }): Promise<{ publicPath: string }> {
    const objectKey = `${folder}/${filename}`;
    const gcsPaths = this.getConfiguredPublicObjectSearchPaths();
    if (gcsPaths.length === 0) {
      const folderSafe = sanitizePublicObjectRelativePath(folder);
      const fileSafe = sanitizePublicObjectRelativePath(filename);
      if (!folderSafe || !fileSafe || fileSafe.includes("/")) {
        throw new Error("Invalid upload path segments");
      }
      const rel = `${folderSafe}/${fileSafe}`;
      const root = path.resolve(process.cwd(), localPublicUploadRoot());
      const abs = path.join(root, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, body);
      return { publicPath: rel };
    }

    const [searchPath] = gcsPaths;
    const fullPath = `${searchPath}/${objectKey}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    await file.save(body, { contentType, resumable: false });
    return { publicPath: objectKey };
  }

  /**
   * Remove a public object by relative path (e.g. `branding/company-logo/uuid.png`).
   * Only paths under `branding/` or legacy `logos/` are allowed.
   */
  async deletePublicAsset(relPath: string): Promise<void> {
    const safeRel = sanitizePublicObjectRelativePath(relPath);
    if (!safeRel || !isManagedBrandingStoragePath(safeRel)) {
      throw new Error("Invalid or disallowed public object path");
    }

    const gcsPaths = this.getConfiguredPublicObjectSearchPaths();
    if (gcsPaths.length === 0) {
      const root = path.resolve(process.cwd(), localPublicUploadRoot());
      const abs = path.join(root, safeRel);
      try {
        await unlink(abs);
      } catch {
        /* missing file is fine */
      }
      return;
    }

    const [searchPath] = gcsPaths;
    const fullPath = `${searchPath}/${safeRel}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    await objectStorageClient.bucket(bucketName).file(objectName).delete({ ignoreNotFound: true });
  }

}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = (await response.json()) as { signed_url: string };
  return signedURL;
}

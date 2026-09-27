export interface FakeS3 {
  url: string;
  bucket: string;
  objects: Map<string, Buffer>;
  requests: { method: string; key: string; query: string }[];
  env: Record<'R2_ENDPOINT' | 'R2_BUCKET' | 'R2_ACCESS_KEY_ID' | 'R2_SECRET_ACCESS_KEY', string>;
  close(): Promise<void>;
}

export function startFakeS3(opts?: { bucket?: string; pageSize?: number }): Promise<FakeS3>;

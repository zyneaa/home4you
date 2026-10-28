//! S3 access with authorized server-side credentials. Objects are fetched
//! fresh from S3 — never from client-supplied URLs.

use aws_sdk_s3::Client as S3Client;

#[derive(Clone)]
pub struct MediaStore {
    client: S3Client,
    bucket: String,
}

impl MediaStore {
    pub fn new(client: S3Client, bucket: String) -> Self {
        Self { client, bucket }
    }

    /// Download an object fully into memory. Callers enforce size limits
    /// after the fact via decode-time resource checks.
    pub async fn get(&self, key: &str) -> anyhow::Result<Vec<u8>> {
        let res = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await?;

        let bytes = res.body.collect().await?.into_bytes().to_vec();
        Ok(bytes)
    }

    /// Upload rendition bytes. PUT with `IfNoneMatch: "*"` semantics are not
    /// supported on the raw-key path; renditions are content-addressed by
    /// pipeline version so overwrites are idempotent.
    pub async fn put(&self, key: &str, bytes: &[u8], content_type: &str) -> anyhow::Result<()> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .body(aws_sdk_s3::primitives::ByteStream::from(bytes.to_vec()))
            .content_type(content_type)
            .send()
            .await?;
        Ok(())
    }
}

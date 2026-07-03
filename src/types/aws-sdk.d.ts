declare module 'aws-sdk' {
  export namespace S3 {
    interface PutObjectRequest {
      Bucket: string;
      Key: string;
      Body: Buffer | string;
      ContentType?: string;
      Metadata?: Record<string, string>;
    }

    interface DeleteObjectRequest {
      Bucket: string;
      Key: string;
    }

    interface HeadBucketRequest {
      Bucket: string;
    }

    interface CreateBucketRequest {
      Bucket: string;
    }

    interface PutBucketPolicyRequest {
      Bucket: string;
      Policy: string;
    }

    interface GetSignedUrlRequest {
      Bucket: string;
      Key: string;
      Expires?: number;
      ContentType?: string;
    }
  }

  export class S3 {
    constructor(options?: {
      endpoint?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
      s3ForcePathStyle?: boolean;
      signatureVersion?: string;
      region?: string;
    });

    upload(params: S3.PutObjectRequest): {
      promise(): Promise<{ Location: string; Bucket: string; Key: string }>;
    };

    deleteObject(params: S3.DeleteObjectRequest): {
      promise(): Promise<{}>;
    };

    headBucket(params: S3.HeadBucketRequest): {
      promise(): Promise<{}>;
    };

    createBucket(params: S3.CreateBucketRequest): {
      promise(): Promise<{ Location: string }>;
    };

    putBucketPolicy(params: S3.PutBucketPolicyRequest): {
      promise(): Promise<{}>;
    };

    getSignedUrlPromise(operation: string, params: S3.GetSignedUrlRequest): Promise<string>;
  }
}


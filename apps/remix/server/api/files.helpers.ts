import { DocumentDataType } from '@prisma/client';

import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { getPresignGetUrl } from '@documenso/lib/universal/upload/server-actions';

export const buildSignedResponse = async (type: DocumentDataType, data: string) => {
  if (type === DocumentDataType.S3_PATH) {
    const { url } = await getPresignGetUrl(data);
    return { type, url } as const;
  }

  if (type === DocumentDataType.BYTES_64 || type === DocumentDataType.BYTES) {
    return { type, data } as const;
  }

  throw new AppError(AppErrorCode.UNKNOWN_ERROR, { message: 'Unsupported document data type' });
};

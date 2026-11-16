import mime from 'mime/lite';

export const contentTypeFor = (path: string) => mime.getType(path) || 'application/octet-stream';

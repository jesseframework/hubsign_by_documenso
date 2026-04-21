/**
 * Upload any file type to the DMS storage.
 * Unlike putPdfFile, this does not validate the file as a PDF.
 */
export const putDmsFile = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/files/upload-dms', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error((error as { error?: string }).error || 'Upload failed');
  }

  return response.json() as Promise<{ id: string; type: string; data: string }>;
};

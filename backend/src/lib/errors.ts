export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const unauthorized = (message = 'Não autenticado') => new HttpError(401, message);
export const forbidden = (message = 'Acesso negado') => new HttpError(403, message);
// Para recursos de outro usuário respondemos 404 (e não 403) para não revelar que existem.
export const notFound = (message = 'Não encontrado') => new HttpError(404, message);
export const conflict = (message: string, details?: unknown) => new HttpError(409, message, details);

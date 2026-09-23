import bcrypt from 'bcryptjs';

const ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 12;

export const hashPassword = (plain: string) => bcrypt.hash(plain, ROUNDS);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// Hash usado para equalizar o tempo de resposta quando o e-mail não existe
let dummyHash: Promise<string> | null = null;
export const getDummyHash = () => (dummyHash ??= bcrypt.hash('senha-inexistente', ROUNDS));

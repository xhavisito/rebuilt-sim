/**
 * Memoria compartida de la IA: el playbook de fábrica (lo aprendido en el entrenamiento) más lo
 * que aprende en este navegador.
 */
import { AiMemory, type MemoryData } from './Memory';
import playbook from './playbook.json';

export const aiMemory = new AiMemory(playbook as MemoryData);

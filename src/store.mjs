import { terminalStatuses } from './domain.mjs';

export class MemoryStore {
  constructor() { this.jobs = new Map(); }
  async create(job) { if (this.jobs.has(job.id)) throw new Error('Job already exists'); this.jobs.set(job.id, structuredClone(job)); }
  async get(id) { const job = this.jobs.get(id); return job ? structuredClone(job) : undefined; }
  async update(id, patch) { const job = this.jobs.get(id); if (!job) throw new Error('Unknown job'); Object.assign(job, structuredClone(patch), { updatedAt: Date.now() }); }
  async claim(id) {
    const job = this.jobs.get(id);
    if (!job || job.expiresAt <= Math.floor(Date.now() / 1000) || terminalStatuses.has(job.status) || (job.status === 'RUNNING' && job.leaseUntil > Date.now())) return false;
    Object.assign(job, { status: 'RUNNING', leaseUntil: Date.now() + 900000, updatedAt: Date.now() });
    return true;
  }
}

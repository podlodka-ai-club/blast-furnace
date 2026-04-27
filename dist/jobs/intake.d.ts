import type { Job } from 'bullmq';
import type { IntakeJobData } from '../types/index.js';
export declare function startIntake(): Promise<void>;
export declare function intakeHandler(job: Job<IntakeJobData>): Promise<void>;
export declare function closeIntakeRedis(): Promise<void>;

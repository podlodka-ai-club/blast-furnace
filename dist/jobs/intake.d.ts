import type { Job } from 'bullmq';
import type { IntakeJobData } from '../types/index.js';
export declare const REPO_LIST_KEY = "github:repos";
export declare function startIntake(): Promise<void>;
export declare function intakeHandler(_job: Job<IntakeJobData>): Promise<void>;
export declare function closeIntakeRedis(): Promise<void>;

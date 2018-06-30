export interface ProgressTracker {
    updateProgress(incrementValue: number): void;
    setMessage(msg: string): void;
    reportError(msg: string, err: Error): void;

    getSubtaskTracker(impactOnTotalProgress: number, subtaskMsg: string): ProgressTracker;
}
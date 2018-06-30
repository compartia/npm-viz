/* Copyright 2015 The TensorFlow Authors. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the 'License');
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an 'AS IS' BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/


import { ProgressTracker } from "../progress_tracker";
import * as _ from 'lodash';


/**
 * Recommended delay (ms) when running an expensive task asynchronously
 * that gives enough time for the progress bar to update its UI.
 */
const ASYNC_TASK_DELAY = 20;

export function time<T>(msg: string, task: () => T) {
    let start = Date.now();
    let result = task();
    /* tslint:disable */
    console.log(msg, ':', Date.now() - start, 'ms');
    /* tslint:enable */
    return result;
}

/**
 * Creates a tracker that sets the progress property of the
 * provided polymer component. The provided component must have
 * a property called 'progress' that is not read-only. The progress
 * property is an object with a numerical 'value' property and a
 * string 'msg' property.
 */
export function getTracker(polymerComponent: any): ProgressTracker {
    return {
        setMessage: function (msg) {
            polymerComponent.set(
                'progress', { value: polymerComponent.progress.value, msg: msg });
        },
        updateProgress: function (value) {
            polymerComponent.set('progress', {
                value: polymerComponent.progress.value + value,
                msg: polymerComponent.progress.msg
            });
        },
        reportError: function (msg: string, err) {
            // Log the stack trace in the console.
            console.error(err.stack);
            // And send a user-friendly message to the UI.
            polymerComponent.set(
                'progress',
                { value: polymerComponent.progress.value, msg: msg, error: true });
        },
        getSubtaskTracker: function (impactOnTotalProgress, subtaskMsg) {
            return getSubtaskTracker(this, impactOnTotalProgress, subtaskMsg);
        }
    };
}


export function getSubtaskTracker(
    parentTracker: ProgressTracker, impactOnTotalProgress: number,
    subtaskMsg: string): ProgressTracker {
    return {
        setMessage: function (progressMsg) {
            // The parent should show a concatenation of its message along with
            // its subtask tracker message.
            parentTracker.setMessage(subtaskMsg + ': ' + progressMsg);
        },
        updateProgress: function (incrementValue) {
            // Update the parent progress relative to the child progress.
            // For example, if the sub-task progresses by 30%, and the impact on the
            // total progress is 50%, then the task progresses by 30% * 50% = 15%.
            parentTracker.updateProgress(
                incrementValue * impactOnTotalProgress / 100);
        },
        reportError: function (msg: string, err: Error) {
            // The parent should show a concatenation of its message along with
            // its subtask error message.
            parentTracker.reportError(subtaskMsg + ': ' + msg, err);
        },
        getSubtaskTracker: function (impactOnTotalProgress: number,
            subtaskMsg: string): ProgressTracker {
            return getSubtaskTracker(this, impactOnTotalProgress, subtaskMsg);
        }
    };
}



/**
 * Runs an expensive task and return the result.
 */
export function runTask<T>(
    msg: string, incProgressValue: number, task: () => T,
    tracker: ProgressTracker): T | undefined {
    // Update the progress message to say the current running task.
    tracker.setMessage(msg);
    // Run the expensive task with a delay that gives enough time for the
    // UI to update.
    try {
        let result = time(msg, task);
        // Update the progress value.
        tracker.updateProgress(incProgressValue);
        // Return the result to be used by other tasks.
        return result;
    } catch (e) {
        // Errors that happen inside asynchronous tasks are
        // reported to the tracker using a user-friendly message.
        tracker.reportError('Failed ' + msg, e);
    }
}

/**
 * Runs an expensive task asynchronously and returns a promise of the result.
 */
export function runAsyncTask<T>(
    msg: string, incProgressValue: number, task: () => T,
    tracker: ProgressTracker): Promise<T> {
    return new Promise((resolve, reject) => {
        // Update the progress message to say the current running task.
        tracker.setMessage(msg);
        // Run the expensive task with a delay that gives enough time for the
        // UI to update.
        setTimeout(function () {
            try {
                let result = time(msg, task);
                // Update the progress value.
                tracker.updateProgress(incProgressValue);
                // Return the result to be used by other tasks.
                resolve(result);
            } catch (e) {
                // Errors that happen inside asynchronous tasks are
                // reported to the tracker using a user-friendly message.
                tracker.reportError('Failed ' + msg, e);
            }
        }, ASYNC_TASK_DELAY);
    });
}

/**
 * Asynchronously runs an expensive task that returns a promise. Updates the
 * tracker's progress after the promise resolves. Returns a new promise that
 * resolves after the progress is updated.
 */
export function runAsyncPromiseTask<T>(
    msg: string, incProgressValue: number, task: () => Promise<T>,
    tracker: ProgressTracker): Promise<T> {
    return new Promise((resolve, reject) => {
        let handleError = function (e: Error) {
            // Errors that happen inside asynchronous tasks are
            // reported to the tracker using a user-friendly message.
            tracker.reportError('Failed ' + msg, e);
            reject(e);
        };

        // Update the progress message to say the current running task.
        tracker.setMessage(msg);
        // Run the expensive task with a delay that gives enough time for the
        // UI to update.
        setTimeout(function () {
            try {
                let start = Date.now();
                task()
                    .then(function (value) {
                        /* tslint:disable */
                        console.log(msg, ':', Date.now() - start, 'ms');
                        // Update the progress value.
                        tracker.updateProgress(incProgressValue);
                        // Return the result to be used by other tasks.
                        resolve(value);
                    })
                    .catch(handleError);
            } catch (e) {
                handleError(e);
            }
        }, ASYNC_TASK_DELAY);
    });
}

 





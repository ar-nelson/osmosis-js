import { Failure } from './types';

export default interface Dispatchable<ActionType> {
  dispatch(action: ActionType, returnFailures: true): Failure[];

  dispatch(action: ActionType, returnFailures?: boolean): void;
}

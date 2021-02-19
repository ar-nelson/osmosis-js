import { Failure } from './types';

export default interface Dispatchable<ActionType> {
  dispatch(action: ActionType, returnFailures: true): Promise<Failure[]>;

  dispatch(action: ActionType, returnFailures?: boolean): Promise<void>;
}

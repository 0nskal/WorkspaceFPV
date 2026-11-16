/** Hand-off of the Autotune screen's PID suggestion to the PID Tuning tab ("Apply to PID tab"). */
export interface SuggestedAxis {
  axis: 'roll' | 'pitch' | 'yaw';
  current: [number, number, number] | null;
  suggested: [number, number, number] | null;
}

let last: SuggestedAxis[] | null = null;

export function publishSuggestion(axes: SuggestedAxis[] | null): void {
  last = axes && axes.some((a) => a.suggested) ? axes : null;
}

export const getSuggestion = (): SuggestedAxis[] | null => last;

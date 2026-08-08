import { useEffect, useState } from 'react';

import { HeadingTracker, type HeadingData } from '../sensors';

export function useHeading(screenAngle: () => number = defaultScreenAngle): HeadingData {
  const [heading, setHeading] = useState<HeadingData>({ headingDeg: null, absolute: true });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const tracker = new HeadingTracker(window, screenAngle);
    return tracker.start(setHeading);
  }, [screenAngle]);

  return heading;
}

function defaultScreenAngle(): number {
  return typeof screen !== 'undefined' && screen.orientation ? screen.orientation.angle : 0;
}

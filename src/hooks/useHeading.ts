import { useEffect, useState } from 'react';

import { HeadingTracker, type HeadingData } from '../sensors';

/**
 * Tracks the compass heading for the 2D sky map. The `deviceorientation`
 * listener is only registered when `enabled` is true — on iOS registering it
 * before `DeviceOrientationEvent.requestPermission()` is granted makes Safari
 * log "No device orientation events will be fired" and never deliver events.
 * Keep it disabled until the user has granted permission (via the AR entry).
 */
export function useHeading(
  enabled: boolean,
  screenAngle: () => number = defaultScreenAngle,
): HeadingData {
  const [heading, setHeading] = useState<HeadingData>({
    headingDeg: null,
    absolute: true,
    accuracyDeg: null,
  });

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }
    const tracker = new HeadingTracker(window, screenAngle);
    return tracker.start(setHeading);
  }, [enabled, screenAngle]);

  return heading;
}

function defaultScreenAngle(): number {
  return typeof screen !== 'undefined' && screen.orientation ? screen.orientation.angle : 0;
}

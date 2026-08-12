export type EclipseKind = 'Total' | 'Annular' | 'Partial';

export interface ObserverLocation {
  lat: number;
  lon: number;
  heightMeters: number;
}

export interface EclipseEventLocal {
  utcIso: string;
  localTime: string;
  sunAltitudeDeg: number;
  sunAzimuthDeg: number;
}

export interface EclipseSample {
  utcIso: string;
  sunAltitudeDeg: number;
  sunAzimuthDeg: number;
  moonAltitudeDeg: number;
  moonAzimuthDeg: number;
  separationDeg: number;
  positionAngleDeg: number;
  rSunDeg: number;
  rMoonDeg: number;
  magnitude: number;
  obscuration: number;
}

export interface UpcomingEclipse {
  /** UTC calendar date (YYYY-MM-DD) of the eclipse's peak. */
  date: string;
  kind: EclipseKind;
  /** Geographic coordinates of greatest eclipse — total/annular eclipses only. */
  latitude?: number;
  longitude?: number;
  /** Fraction (0,1] of the Sun's disc obscured at greatest eclipse — total/annular only. */
  obscuration?: number;
}

export interface EclipseView {
  kind: EclipseKind;
  eclipseDateIso: string;
  timezone: string;
  daysUntil: number;
  times: {
    begin: EclipseEventLocal;
    peak: EclipseEventLocal;
    end: EclipseEventLocal;
  };
  totalitySeconds: number | null;
  magnitude: number;
  obscuration: number;
  sunAltitudePeakDeg: number;
  sunAzimuthPeakDeg: number;
  moonPositionAngleDeg: number;
  rSunDeg: number;
  rMoonDeg: number;
  separationDeg: number;
  observer: ObserverLocation;
}

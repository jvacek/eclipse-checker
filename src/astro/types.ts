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
  observer: ObserverLocation;
}

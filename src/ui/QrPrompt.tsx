export const QR_SITE_URL = 'https://eclipse-checker.vercel.app';

interface QrPromptProps {
  compact?: boolean;
}

/** Static QR prompt pointing at the phone-friendly site, for devices with no compass. */
export function QrPrompt({ compact = false }: QrPromptProps) {
  if (compact) {
    return (
      <div className="qr-prompt">
        <img
          className="qr-prompt-qr"
          src="/eclipse-checker-qr.svg"
          alt={`QR code to ${QR_SITE_URL}`}
          width="96"
          height="96"
        />
        <p className="qr-prompt-copy">
          The compass view needs a phone. Scan to open on your device.
        </p>
      </div>
    );
  }
  return (
    <div className="qr-prompt-full">
      <h2>AR needs a compass</h2>
      <p>
        The AR view points to the Sun using your phone's compass. Open this page on a phone with a
        magnetometer to see the eclipse in AR.
      </p>
      <img
        className="qr-prompt-qr"
        src="/eclipse-checker-qr.svg"
        alt={`QR code to ${QR_SITE_URL}`}
        width="178"
        height="178"
      />
      <a className="qr-prompt-link" href={QR_SITE_URL} target="_blank" rel="noreferrer">
        {QR_SITE_URL}
      </a>
    </div>
  );
}

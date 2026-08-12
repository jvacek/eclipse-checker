// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import App from '../../src/App';
import type { GeolocationLike } from '../../src/sensors';

function stubGeolocation(impl: GeolocationLike): void {
  Object.defineProperty(navigator, 'geolocation', { value: impl, configurable: true });
}

function successGeo(coords: { lat: number; lon: number; accuracy?: number }): GeolocationLike {
  return {
    getCurrentPosition: (success) =>
      success({
        coords: {
          latitude: coords.lat,
          longitude: coords.lon,
          altitude: null,
          accuracy: coords.accuracy ?? 20,
        },
      }),
  };
}

function deniedGeo(): GeolocationLike {
  return {
    getCurrentPosition: (_success, error) => error({ code: 1, message: 'denied' }),
  };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('App landing', () => {
  it('renders both entry points', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Find my location' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enter coordinates manually' })).toBeInTheDocument();
  });

  it('lists the next upcoming solar eclipses', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Upcoming solar eclipses' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
  });

  it('deep-links straight to results from a share URL', () => {
    window.history.replaceState(
      null,
      '',
      '/?lat=64.1466&lon=-21.9426&height=61&eclipseDate=2026-08-12&kind=Total',
    );
    render(<App />);
    expect(screen.getByRole('heading', { name: /Total eclipse — 2026-08-12/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Find my location' })).not.toBeInTheDocument();
  });

  it('shows a passed notice for a past-eclipse share link', () => {
    window.history.replaceState(
      null,
      '',
      '/?lat=64.1466&lon=-21.9426&height=61&eclipseDate=2026-08-12&kind=Total',
    );
    const realNow = Date.now;
    Date.now = () => new Date('2026-08-20T00:00:00Z').getTime();
    try {
      render(<App />);
      expect(
        screen.getByRole('heading', { name: /Total eclipse — 2026-08-12/ }),
      ).toBeInTheDocument();
      expect(screen.getByText('This eclipse has already passed.')).toBeInTheDocument();
    } finally {
      Date.now = realNow;
    }
  });
});

describe('App manual flow', () => {
  it('computes results from the manual form', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Enter coordinates manually' }));
    await user.type(screen.getByLabelText(/Latitude/), '40.4168');
    await user.type(screen.getByLabelText(/Longitude/), '-3.7038');
    await user.click(screen.getByRole('button', { name: 'Show eclipse' }));

    expect(screen.getByRole('heading', { name: /eclipse —/ })).toBeInTheDocument();
    expect(screen.getByText('Peak')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /share/i })).toBeInTheDocument();
  });

  it('rejects invalid coordinates with a message', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Enter coordinates manually' }));
    await user.clear(screen.getByLabelText(/Latitude/));
    await user.type(screen.getByLabelText(/Latitude/), '95');
    await user.click(screen.getByRole('button', { name: 'Show eclipse' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/Latitude must be/);
  });
});

describe('App geolocation flow', () => {
  it('locates and shows results when permission is granted', async () => {
    stubGeolocation(successGeo({ lat: 64.1466, lon: -21.9426 }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Find my location' }));

    expect(await screen.findByRole('heading', { name: /Total eclipse/ })).toBeInTheDocument();
    expect(screen.getByText(/Location accuracy ±20 m/)).toBeInTheDocument();
  });

  it('shows a QR prompt instead of the compass button when no compass is available', async () => {
    stubGeolocation(successGeo({ lat: 64.1466, lon: -21.9426 }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Find my location' }));
    await screen.findByRole('heading', { name: /Total eclipse/ });

    // jsdom has no touch/coarse pointer, so isCompassAvailable() is false.
    expect(screen.queryByRole('button', { name: 'Activate compass' })).not.toBeInTheDocument();
    expect(document.querySelector('.qr-prompt-qr')).not.toBeNull();
    expect(screen.getByText(/Scan to open on your device/i)).toBeInTheDocument();
  });

  it('does not mark the compass active after returning from the no-compass AR view', async () => {
    stubGeolocation(successGeo({ lat: 64.1466, lon: -21.9426 }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Find my location' }));
    await screen.findByRole('heading', { name: /Total eclipse/ });

    // Enter AR (no compass → QR prompt), then back out to results.
    await user.click(screen.getByRole('button', { name: 'View in AR' }));
    expect(await screen.findByText(/AR needs a compass/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to results' }));

    // The compass was never authorized on this device, so results must not
    // claim it is active — the QR prompt should remain.
    await screen.findByRole('heading', { name: /Total eclipse/ });
    expect(screen.queryByText('Compass active')).not.toBeInTheDocument();
    expect(document.querySelector('.qr-prompt-qr')).not.toBeNull();
  });

  it('falls back to the manual form when permission is denied', async () => {
    stubGeolocation(deniedGeo());
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Find my location' }));

    expect(await screen.findByRole('button', { name: 'Show eclipse' })).toBeInTheDocument();
    expect(screen.getByText(/Location permission was denied/)).toBeInTheDocument();
  });
});

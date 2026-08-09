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
    expect(
      screen.getByRole('button', { name: 'Enter coordinates manually' }),
    ).toBeInTheDocument();
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

  it('falls back to the manual form when permission is denied', async () => {
    stubGeolocation(deniedGeo());
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Find my location' }));

    expect(await screen.findByRole('button', { name: 'Show eclipse' })).toBeInTheDocument();
    expect(screen.getByText(/Location permission was denied/)).toBeInTheDocument();
  });
});

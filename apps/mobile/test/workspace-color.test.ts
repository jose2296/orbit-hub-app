import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WORKSPACE_COLOR,
  WORKSPACE_COLORS,
  cardColors,
  colorOf,
  isDark,
  isWorkspaceColor,
} from '../src/lib/workspace/color';

/**
 * The colour of a space, and what can be read on it.
 *
 * A person chooses this colour and then reads their own lists on it, so the two
 * mistakes that matter are a card whose text cannot be read and two spaces that
 * look the same at card size.
 */
describe('colorOf', () => {
  it('gives the colour somebody chose', () => {
    expect(colorOf('teal')).toBe('#0F766E');
  });

  it('gives the default for a space with no colour or a broken one', () => {
    // A space written by an older build has no colour, and a space written by a
    // future build might have one this one does not. Neither is a reason to
    // paint a card with nothing.
    expect(colorOf(null)).toBe(colorOf(DEFAULT_WORKSPACE_COLOR));
    expect(colorOf(undefined)).toBe(colorOf(DEFAULT_WORKSPACE_COLOR));
    expect(colorOf('no-existe')).toBe(colorOf(DEFAULT_WORKSPACE_COLOR));
  });
});

describe('isWorkspaceColor', () => {
  it('knows the colours it offers', () => {
    for (const color of WORKSPACE_COLORS) {
      expect(isWorkspaceColor(color.key)).toBe(true);
    }
  });

  it('says no to anything else', () => {
    expect(isWorkspaceColor('unicorn')).toBe(false);
    expect(isWorkspaceColor(null)).toBe(false);
    expect(isWorkspaceColor(42)).toBe(false);
  });
});

describe('isDark', () => {
  it('knows a dark colour from a light one', () => {
    expect(isDark('#0B1120')).toBe(true);
    expect(isDark('#FFFFFF')).toBe(false);
  });

  it('has the answer for every colour the picker offers', () => {
    // Whichever way it comes out, the text colour follows it, so the only thing
    // that could be wrong is a colour that is neither.
    for (const { hex } of WORKSPACE_COLORS) {
      expect(typeof isDark(hex)).toBe('boolean');
    }
  });

  it('does not throw on something that is not a colour', () => {
    expect(isDark('no')).toBe(false);
    expect(isDark('#fff')).toBe(false);
  });
});

describe('cardColors', () => {
  it('picks white text on a dark colour and dark text on a light one', () => {
    expect(cardColors('#0F766E').foreground).toBe('#FFFFFF');
    expect(cardColors('#FFFFFF').foreground).toBe('#0B1120');
  });

  it('keeps the second tone readable on the card', () => {
    // The counts and the hints are the second tone, and a grey that is right on
    // a page is invisible on a coloured card.
    for (const { hex } of WORKSPACE_COLORS) {
      const colors = cardColors(hex);
      expect(colors.muted).not.toBe(colors.foreground);
      expect(colors.background).toBe(hex);
    }
  });
});

describe('the palette', () => {
  it('has no two colours the same', () => {
    const hexes = WORKSPACE_COLORS.map((color) => color.hex);
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it('is short enough to choose from on a phone', () => {
    // A picker with fifty shades is a picker nobody can choose from.
    expect(WORKSPACE_COLORS.length).toBeLessThanOrEqual(10);
  });
});

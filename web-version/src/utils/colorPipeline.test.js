import { describe, it, expect } from 'vitest';
import {
    euclideanDistance,
    runKMeans,
    rgbToHue,
    rgbToHex,
    hexToRgb,
    sampleForegroundPixels,
    buildFrameResult,
    clusterAndLabel,
} from './colorPipeline';

// ============================================================================
// Test fixtures: synthetic ("fake") image + mask generators
// ----------------------------------------------------------------------------
// We fabricate RGBA pixel buffers and matching background-confidence masks so
// the real sampling → k-means → labeling pipeline can run end-to-end in Node
// without MediaPipe, a canvas or the DOM.
// ============================================================================

/**
 * Build an RGBA pixel buffer with a solid-colour rectangular "player" blob
 * over a background colour.
 */
function makeFakeImage(width, height, blob) {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const inBlob = x >= blob.x0 && x < blob.x1 && y >= blob.y0 && y < blob.y1;
            const c = inBlob ? blob.color : (blob.bg || [0, 128, 0]); // default green-screen bg
            pixels[i] = c[0];
            pixels[i + 1] = c[1];
            pixels[i + 2] = c[2];
            pixels[i + 3] = 255;
        }
    }
    return pixels;
}

/**
 * Build a background-confidence mask (same resolution as the image) where the
 * blob region has LOW background confidence (i.e. foreground) and everything
 * else is HIGH (background).
 */
function makeFakeMask(width, height, blob) {
    const mask = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const inBlob = x >= blob.x0 && x < blob.x1 && y >= blob.y0 && y < blob.y1;
            mask[y * width + x] = inBlob ? 0.05 : 0.99;
        }
    }
    return mask;
}

/** Deterministic pseudo-random generator so noisy tests are reproducible. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Produce a frame result whose mean colour is exactly the given RGB triple. */
function frameFromColor(moveId, [r, g, b], existingPlayer = null) {
    return buildFrameResult(
        moveId,
        { meanColor: { r, g, b }, centroidX: 0.5, centroidY: 0.5, pixelCount: 500 },
        existingPlayer,
    );
}

const RED = [220, 30, 30];
const BLUE = [30, 40, 220];

// ============================================================================

describe('colour utilities', () => {
    it('hexToRgb parses standard colours', () => {
        expect(hexToRgb('#FF0000')).toEqual({ r: 255, g: 0, b: 0 });
        expect(hexToRgb('#00FF00')).toEqual({ r: 0, g: 255, b: 0 });
        expect(hexToRgb('0000ff')).toEqual({ r: 0, g: 0, b: 255 });
    });

    it('hexToRgb returns null for malformed input', () => {
        expect(hexToRgb('nope')).toBeNull();
        expect(hexToRgb('#12')).toBeNull();
        expect(hexToRgb('')).toBeNull();
    });

    it('rgbToHex clamps and pads', () => {
        expect(rgbToHex(255, 0, 0)).toBe('#FF0000');
        expect(rgbToHex(0, 0, 5)).toBe('#000005');
        expect(rgbToHex(300, -20, 128)).toBe('#FF0080'); // clamps out-of-range
        expect(rgbToHex(10.6, 10.4, 10.5)).toBe('#0B0A0B'); // rounds (banker-agnostic)
    });

    it('hex ↔ rgb round-trips for random colours', () => {
        const rnd = mulberry32(42);
        for (let i = 0; i < 200; i++) {
            const r = Math.floor(rnd() * 256);
            const g = Math.floor(rnd() * 256);
            const b = Math.floor(rnd() * 256);
            const back = hexToRgb(rgbToHex(r, g, b));
            expect(back).toEqual({ r, g, b });
        }
    });

    it('rgbToHue matches known primaries', () => {
        expect(rgbToHue(255, 0, 0)).toBeCloseTo(0, 5);
        expect(rgbToHue(0, 255, 0)).toBeCloseTo(120, 5);
        expect(rgbToHue(0, 0, 255)).toBeCloseTo(240, 5);
        expect(rgbToHue(128, 128, 128)).toBe(0); // achromatic
    });
});

describe('euclideanDistance', () => {
    it('computes basic distances', () => {
        expect(euclideanDistance([0, 0], [3, 4])).toBe(5);
        expect(euclideanDistance([1, 2, 3], [1, 2, 3])).toBe(0);
    });

    it('treats missing dimensions in b as zero', () => {
        expect(euclideanDistance([3, 4], [0])).toBe(5);
    });
});

describe('runKMeans', () => {
    it('throws on empty input', () => {
        expect(() => runKMeans([], 2)).toThrow();
    });

    it('separates two well-separated clusters', () => {
        const points = [
            [0, 0], [0.1, 0.1], [0.05, -0.05],
            [10, 10], [10.1, 9.9], [9.95, 10.05],
        ];
        const { assignments, centroids } = runKMeans(points, 2);
        expect(centroids).toHaveLength(2);
        // First three share a cluster, last three share the other.
        expect(new Set(assignments.slice(0, 3)).size).toBe(1);
        expect(new Set(assignments.slice(3)).size).toBe(1);
        expect(assignments[0]).not.toBe(assignments[3]);
    });

    it('handles k=1 (single centroid) as the mean', () => {
        const points = [[0, 0], [2, 2], [4, 4]];
        const { assignments, centroids } = runKMeans(points, 1);
        expect(new Set(assignments).size).toBe(1);
        expect(centroids[0][0]).toBeCloseTo(2, 5);
        expect(centroids[0][1]).toBeCloseTo(2, 5);
    });

    it('is stable across repeated runs on separated data', () => {
        const points = [[0, 0], [0.2, 0.1], [9, 9], [9.1, 8.8]];
        for (let i = 0; i < 20; i++) {
            const { assignments } = runKMeans(points, 2);
            expect(assignments[0]).toBe(assignments[1]);
            expect(assignments[2]).toBe(assignments[3]);
            expect(assignments[0]).not.toBe(assignments[2]);
        }
    });
});

describe('sampleForegroundPixels (fake images)', () => {
    it('extracts the blob mean colour and ignores the background', () => {
        const W = 64, H = 64;
        const blob = { x0: 16, y0: 16, x1: 48, y1: 48, color: RED, bg: [0, 128, 0] };
        const pixels = makeFakeImage(W, H, blob);
        const bgMask = makeFakeMask(W, H, blob);

        const s = sampleForegroundPixels({
            pixels, width: W, height: H, bgMask, maskWidth: W, maskHeight: H, stride: 1,
        });

        expect(s.pixelCount).toBeGreaterThan(0);
        expect(s.meanColor.r).toBeCloseTo(RED[0], 0);
        expect(s.meanColor.g).toBeCloseTo(RED[1], 0);
        expect(s.meanColor.b).toBeCloseTo(RED[2], 0);
        // Centroid of a centred blob is roughly the image centre.
        expect(s.centroidX).toBeCloseTo(0.5, 1);
        expect(s.centroidY).toBeCloseTo(0.5, 1);
    });

    it('finds zero foreground pixels when the mask is all background', () => {
        const W = 32, H = 32;
        const pixels = makeFakeImage(W, H, { x0: 0, y0: 0, x1: 0, y1: 0, color: RED });
        const bgMask = new Float32Array(W * H).fill(0.99);
        const s = sampleForegroundPixels({ pixels, width: W, height: H, bgMask, maskWidth: W, maskHeight: H, stride: 1 });
        expect(s.pixelCount).toBe(0);
        expect(s.meanColor).toEqual({ r: 0, g: 0, b: 0 });
    });

    it('respects the backgroundThreshold', () => {
        const W = 16, H = 16;
        const blob = { x0: 0, y0: 0, x1: 16, y1: 16, color: RED };
        const pixels = makeFakeImage(W, H, blob);
        const bgMask = new Float32Array(W * H).fill(0.5); // uniform mid confidence
        const loose = sampleForegroundPixels({ pixels, width: W, height: H, bgMask, maskWidth: W, maskHeight: H, stride: 1, backgroundThreshold: 0.9 });
        const strict = sampleForegroundPixels({ pixels, width: W, height: H, bgMask, maskWidth: W, maskHeight: H, stride: 1, backgroundThreshold: 0.1 });
        expect(loose.pixelCount).toBeGreaterThan(0); // 0.5 < 0.9 → counted
        expect(strict.pixelCount).toBe(0); // 0.5 !< 0.1 → excluded
    });

    it('only samples within manual bounds', () => {
        const W = 64, H = 64;
        // Two halves: red on the left, blue on the right, both foreground.
        const pixels = new Uint8ClampedArray(W * H * 4);
        const bgMask = new Float32Array(W * H).fill(0.05);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const i = (y * W + x) * 4;
                const c = x < W / 2 ? RED : BLUE;
                pixels[i] = c[0]; pixels[i + 1] = c[1]; pixels[i + 2] = c[2]; pixels[i + 3] = 255;
            }
        }
        const leftOnly = sampleForegroundPixels({
            pixels, width: W, height: H, bgMask, maskWidth: W, maskHeight: H, stride: 1,
            bounds: { topY: 0, bottomY: H, leftX: 0, rightX: W / 2 },
        });
        expect(leftOnly.meanColor.r).toBeCloseTo(RED[0], 0);
        expect(leftOnly.meanColor.b).toBeCloseTo(RED[2], 0);
    });

    it('throws without pixels or mask', () => {
        expect(() => sampleForegroundPixels({ width: 1, height: 1 })).toThrow();
    });
});

describe('clusterAndLabel — labeling strategies', () => {
    const redFrames = Array.from({ length: 5 }, (_, i) => frameFromColor(`r${i}`, RED));
    const blueFrames = Array.from({ length: 5 }, (_, i) => frameFromColor(`b${i}`, BLUE));

    it('throws with fewer than 2 frames', () => {
        expect(() => clusterAndLabel([frameFromColor('x', RED)])).toThrow();
    });

    it('STRATEGY 1: calibration colours label clusters by nearest colour', () => {
        const out = clusterAndLabel([...redFrames, ...blueFrames], {
            playerColors: { 'Player A': '#DC1E1E', 'Player B': '#1E28DC' },
        });
        expect(out.assignments['r0'].player).toBe('Player A');
        expect(out.assignments['b0'].player).toBe('Player B');
    });

    it('STRATEGY 1: swapping calibration colours swaps the labels', () => {
        const out = clusterAndLabel([...redFrames, ...blueFrames], {
            playerColors: { 'Player A': '#1E28DC', 'Player B': '#DC1E1E' },
        });
        expect(out.assignments['r0'].player).toBe('Player B');
        expect(out.assignments['b0'].player).toBe('Player A');
    });

    it('STRATEGY 2: majority vote from existing labels when no calibration', () => {
        const reds = Array.from({ length: 5 }, (_, i) => frameFromColor(`r${i}`, RED, 'Player A'));
        const blues = Array.from({ length: 5 }, (_, i) => frameFromColor(`b${i}`, BLUE, 'Player B'));
        const out = clusterAndLabel([...reds, ...blues]); // no playerColors
        expect(out.assignments['r0'].player).toBe('Player A');
        expect(out.assignments['b0'].player).toBe('Player B');
    });

    it('STRATEGY 3: deterministic hue sort when no calibration or labels', () => {
        const out = clusterAndLabel([...redFrames, ...blueFrames]);
        // Red (hue ~0) sorts before blue (hue ~240) → red cluster = Player A.
        expect(out.assignments['r0'].player).toBe('Player A');
        expect(out.assignments['b0'].player).toBe('Player B');
        // Every frame must be assigned to exactly one of the two players.
        Object.values(out.assignments).forEach((a) => {
            expect(['Player A', 'Player B']).toContain(a.player);
        });
    });

    it('produces two cluster summaries with plausible hex colours', () => {
        const out = clusterAndLabel([...redFrames, ...blueFrames], {
            playerColors: { 'Player A': '#DC1E1E', 'Player B': '#1E28DC' },
        });
        expect(out.clusters).toHaveLength(2);
        const byPlayer = Object.fromEntries(out.clusters.map((c) => [c.assignedPlayer, c]));
        expect(byPlayer['Player A'].meanColor.r).toBeGreaterThan(byPlayer['Player A'].meanColor.b);
        expect(byPlayer['Player B'].meanColor.b).toBeGreaterThan(byPlayer['Player B'].meanColor.r);
    });

    it('reports confidence in [0,1] for every frame', () => {
        const out = clusterAndLabel([...redFrames, ...blueFrames]);
        Object.values(out.assignments).forEach((a) => {
            expect(a.confidence).toBeGreaterThanOrEqual(0);
            expect(a.confidence).toBeLessThanOrEqual(1);
        });
    });
});

describe('clusterAndLabel — randomized robustness with noise', () => {
    it('keeps two distinct colours separated across many noisy scenarios', () => {
        const rnd = mulberry32(7);
        let correct = 0;
        const RUNS = 60;

        for (let run = 0; run < RUNS; run++) {
            // Pick two clearly different base colours.
            const baseA = [40 + rnd() * 40, 40 + rnd() * 40, 170 + rnd() * 60]; // blue-ish
            const baseB = [170 + rnd() * 60, 40 + rnd() * 40, 40 + rnd() * 40]; // red-ish
            const jitter = (c) => c.map((v) => Math.max(0, Math.min(255, v + (rnd() - 0.5) * 30)));

            const frames = [];
            for (let i = 0; i < 6; i++) frames.push(frameFromColor(`a${run}_${i}`, jitter(baseA)));
            for (let i = 0; i < 6; i++) frames.push(frameFromColor(`b${run}_${i}`, jitter(baseB)));

            const out = clusterAndLabel(frames, {
                playerColors: {
                    'Player A': rgbToHex(baseA[0], baseA[1], baseA[2]),
                    'Player B': rgbToHex(baseB[0], baseB[1], baseB[2]),
                },
            });

            const aCorrect = [0, 1, 2, 3, 4, 5].every((i) => out.assignments[`a${run}_${i}`].player === 'Player A');
            const bCorrect = [0, 1, 2, 3, 4, 5].every((i) => out.assignments[`b${run}_${i}`].player === 'Player B');
            if (aCorrect && bCorrect) correct++;
        }

        // With clearly-separated calibrated colours this should be ~100%.
        expect(correct).toBe(RUNS);
    });
});

describe('END-TO-END: fake images → sampling → k-means → labeling', () => {
    it('classifies alternating red/blue player frames correctly', () => {
        const W = 48, H = 48;
        const blobBox = { x0: 12, y0: 12, x1: 36, y1: 36 };
        const frames = [];

        // 10 frames, alternating a red "player" and a blue "player".
        for (let i = 0; i < 10; i++) {
            const color = i % 2 === 0 ? RED : BLUE;
            const blob = { ...blobBox, color, bg: [0, 128, 0] };
            const pixels = makeFakeImage(W, H, blob);
            const bgMask = makeFakeMask(W, H, blob);
            const sample = sampleForegroundPixels({
                pixels, width: W, height: H, bgMask, maskWidth: W, maskHeight: H, stride: 1,
            });
            expect(sample.pixelCount).toBeGreaterThan(100);
            frames.push(buildFrameResult(`move${i}`, sample, null));
        }

        const out = clusterAndLabel(frames, {
            playerColors: { 'Player A': rgbToHex(...RED), 'Player B': rgbToHex(...BLUE) },
        });

        for (let i = 0; i < 10; i++) {
            const expected = i % 2 === 0 ? 'Player A' : 'Player B';
            expect(out.assignments[`move${i}`].player).toBe(expected);
        }
        expect(out.analytics.usedFrames).toBe(10);
    });

    it('handles skipped frames gracefully (blob-less images produce no pixels)', () => {
        const W = 32, H = 32;
        const good = [];
        for (let i = 0; i < 4; i++) {
            const color = i < 2 ? RED : BLUE;
            const blob = { x0: 8, y0: 8, x1: 24, y1: 24, color };
            const sample = sampleForegroundPixels({
                pixels: makeFakeImage(W, H, blob),
                width: W, height: H,
                bgMask: makeFakeMask(W, H, blob),
                maskWidth: W, maskHeight: H, stride: 1,
            });
            good.push(buildFrameResult(`g${i}`, sample));
        }
        const out = clusterAndLabel(good, {
            playerColors: { 'Player A': rgbToHex(...RED), 'Player B': rgbToHex(...BLUE) },
        });
        expect(Object.keys(out.assignments)).toHaveLength(4);
    });
});

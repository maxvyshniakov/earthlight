# Radiance ledger and ISS camera references, 2026-10-16

First step of balancing the lighting physically without losing the current
look: tie scene units to photometry, measure every emitter against sourced
values, and collect real ISS photographs with their camera settings to
calibrate the virtual camera against. Nothing in the picture changes here.

## Scene units

Sunlight at 1 AU has scene irradiance 2.2 (`SOLAR_IRRADIANCE`). With the
luminous solar constant of 133.3 klx (Darula, Kittler & Gueymard 2005), one
unit of scene radiance is **6.06 × 10⁴ cd/m²** (`SCENE_CANDELA` in
`src/scripts/radiometry.ts`). The solar disk then comes out at 1.96 × 10⁹
cd/m² and a Lambertian cloud of visible albedo 0.8 at 3.4 × 10⁴ cd/m²,
both inside their sourced ranges (`scripts/radiometry.test.mjs`).

## The ledger

`scripts/radiance-ledger.mjs <base-url> <out>` opens one view per source in an
isolated agent-browser session and reads the scene buffer that the exposure
meter samples, through a page init script; the renderer is unchanged. Each
view isolates one class of pixels. Numbers are scene radiance; the factor is
the scene value over the geometric mean of the physical range. Raw values are
in [evidence/radiance-ledger-2026-10-16.json](evidence/radiance-ledger-2026-10-16.json).

| Source | Scene | Physical (cd/m²) | Factor |
| --- | ---: | ---: | ---: |
| Solar disk, mean | 3.24 × 10⁴ | 1.85–2.05 × 10⁹ | 1.0 |
| Sunlit cloud tops, Sun overhead (p99) | 0.40 | 2.5–4 × 10⁴ | 0.8 |
| Sunlit Earth, typical (p50) | 0.077 | 2 × 10³–1.3 × 10⁴ | 0.9 |
| Lunar surface, lit part, phase angle 115° (p50) | 1.78 | 400–750 | **200** |
| City lights, bright core (p99) | 0.19 | 0.5–16 | **4 × 10³** |
| Aurora, bright green (p99) | 0.024 | 0.019–0.19 | **2.4 × 10⁴** |
| Airglow at the night limb (p99) | 1.2 × 10⁻³ | 3–7 × 10⁻³ | **1.5 × 10⁴** |
| Milky Way, bright (p90) | 1.5 × 10⁻³ | 1–2 × 10⁻³ | **6 × 10⁴** |
| Dark sky above the airglow (p50) | 1.2 × 10⁻⁶ | 0.5–3 × 10⁻⁴ | **600** |
| Magnitude-0 star, flux / Sun | 1.5 × 10⁻⁶ | 1.9–2.0 × 10⁻¹¹ | **8 × 10⁴** |

Day is physical: the Sun, cloud and ground agree within 25%. Everything
lit by night, and the Moon, is 10²–10⁵ too bright, and unevenly so: the
Milky Way is lifted 15× more than city lights relative to physics. Star
flux is also set per CSS pixel, so it changes with window size.

Physical ranges and their derivations:

- **Sun.** E/Ω with E = 128–133 klx (Darula et al. 2005; IAU 2015 solar radius), ±3% over the year.
- **Cloud and ground.** Lambertian a·E/π: cloud visible albedo a ≈ τ/(τ+7), 0.6–0.93 ([Wood 2012](https://www.chem.pmf.hr/_download/repository/Review_Sc_clouds_R_Wood_MWR_2012.pdf)); ocean ~0.05 to land 0.14–0.3, broadband ([NASA](https://science.nasa.gov/earth/earth-observatory/measuring-earths-albedo-84499/), [Jin et al. 2004](https://www.giss.nasa.gov/pubs/abs/ji00200u.html)). No photopic per-class land reflectance was found.
- **Moon.** Full-disk 4 900–5 400 cd/m² measured near full ([Schmidt 2009](https://spaceweather.com/swpod2009/13jan09/Perigee_moon_2009_01_11_corr.pdf)); phase law m(α) = −12.73 + 0.026|α| + 4 × 10⁻⁹α⁴ ([Krisciunas & Schaefer 1991](http://dx.doi.org/10.1086/132921)); at 115° the disk is 3.3% of full, over a 29% lit fraction: ~570 cd/m², ±30%.
- **City lights.** VIIRS DNB, brightest urban area Las Vegas 2 800 nW cm⁻² sr⁻¹ ([Elvidge et al. 2017](https://repository.library.noaa.gov/view/noaa/68849)); 0.0036–0.0059 cd/m² per nW cm⁻² sr⁻¹ for HPS and 0.0057 for 4000 K LED (derived from the [DNB response](https://nwp-saf.eumetsat.int/downloads/rtcoef_info/visir_srf/rtcoef_jpss_0_viirs_srf.html) and CIE lamp spectra): 10–16 cd/m². The lower bound, ~100 nW, is an estimate; no typical urban-core value was found.
- **Aurora.** 1 kR at 557.7 nm = 1.93 × 10⁻⁴ cd/m² ([Baker & Romick 1976](https://espy.folk.ntnu.no/Second/Master_Student_Resources/Airglow/references/Baker_Rayleigh_ao-15-8-1966.pdf)); IBC III–IV are 100–1000 kR ([BoM](https://www.sws.bom.gov.au/Educational/1/1/8)). The oblique enhancement seen from orbit is not sourced.
- **Airglow.** V-band airglow 1.2 × 10⁻⁴ cd/m² at zenith ([Masana et al. 2021](https://ar5iv.labs.arxiv.org/html/2101.01500)), ×35 seen edge-on ([Koomen et al. 1971](https://ntrs.nasa.gov/citations/19720003209)), ×44–56 for a Gaussian layer.
- **Night sky.** Bright Milky Way 19.6 mag/arcsec² ≈ 1.5 × 10⁻³ cd/m² ([NPS](https://www.nps.gov/subjects/nightskies/NSQmetrics.html)); above the airglow, zodiacal light, starlight and galactic light ≈ 1.4 × 10⁻⁴ cd/m² (from Masana et al.), 5 × 10⁻⁵ at the ecliptic pole to 2 × 10⁻³ at 30° from the Sun ([Leinert et al. 1998](https://skyscapes.readthedocs.io/en/latest/_modules/skyscapes/background/leinert.html), secondary).
- **Stars.** A magnitude-0 star gives 2.54 × 10⁻⁶ lx (Allen, via [Bará et al. 2017](https://arxiv.org/abs/1710.06755)).

The solar constant and some albedo and zodiacal figures were read from
abstracts or third-party reproductions because the publisher pages refused
access; they are marked secondary in the research notes.

## ISS photographs as camera references

Settings from NASA's EXIF metadata (`images-assets.nasa.gov/image/<id>/metadata.json`),
times and nadir from archived EOL pages. EV100 = log₂(N²/t) − log₂(ISO/100).

| Category | Photo | Camera, lens | f/ | t | ISO | EV100 | In frame |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| Daylit | [ISS041-E-78247](https://images-assets.nasa.gov/image/iss041e078247/metadata.json) | D3S, 17 mm | 5 | 1/6400 | 200 | +16.3 | Hurricane Gonzalo, 2014-10-16 18:55 GMT |
| Daylit | [ISS024-E-14559](https://images-assets.nasa.gov/image/iss024e014559/metadata.json) | D2Xs, 17 mm | 11 | 1/500 | 200 | +14.9 | Hurricane Igor, 2010-09-14 13:55 |
| City lights | [ISS030-E-10008](https://images-assets.nasa.gov/image/iss030e010008/metadata.json) | D3S, 24 mm | 2.8 | 0.8 s | 12 800 | −3.7 | Iberia at night, 2011-12-04 00:13 |
| City lights | [ISS030-E-99324](https://images-assets.nasa.gov/image/iss030e099324/metadata.json) | D3S, 400 mm | 2.8 | 1/40 | 8 000 | +2.0 | Dubai, 2012-02-22 19:24 |
| Aurora | [ISS030-E-102292](https://images-assets.nasa.gov/image/iss030e102292/metadata.json) | D3S, 50 mm | 1.4 | 0.5 s | 6 400 | −4.0 | Aurora over Canada with limb, 2012-01-25 09:29 |
| Aurora | [ISS029-E-7502](https://images-assets.nasa.gov/image/iss029e007502/metadata.json) | D3S, 24 mm | 2.8 | 1.3 s | 12 800 | −4.4 | Aurora australis and airglow, 2011-09-18 13:28 |
| Night limb | [ISS030-E-7397](https://images-assets.nasa.gov/image/iss030e007397/metadata.json) | D3S, 20 mm | 3.2 | 1.3 s | 12 800 | −4.0 | Airglow and stars, N Pacific, 2011-11-24 15:36 |
| Moon | [ISS028-E-20072](https://images-assets.nasa.gov/image/iss028e020072/metadata.json) | D3S, 400 mm | 2.8 | 1/25 | 1 250 | +4.0 | Crescent Moon above the sunset limb, 2011-07-31 13:51 |
| Moon | [ISS051-E-39977](https://images-assets.nasa.gov/image/iss051e039977/metadata.json) | D4, 240 mm | 20 | 1/200 | 800 | +13.3 | Moon above the daylit limb, 2017-05-08 20:22 |
| Sun on limb | [ISS028-E-7274](https://images-assets.nasa.gov/image/iss028e007274/metadata.json) | D2Xs, 400 mm | 2.8 | 1/500 | 200 | +10.9 | Part of the Sun over the limb, 2011-06-11 20:40 |

Day and night frames are about 20 stops apart. Night time-lapses were shot on
the D3S at ISO ~10 000 or more, ~1 s, wide open ([NASA Fragile Oasis, 2011](http://web.archive.org/web/20170325184332/https://blogs.nasa.gov/fragileoasis/2011/11/25/post_1321894326745/));
the Sony α7S II on Kibo records 4K video up to ISO 409 600 ([report](https://www.photographyblog.com/news/sony_a7s_ii_shoots_astonishing_4k_videos_from_space), frame rate not stated).

## The virtual camera against them

Our camera's automatic settings as EV100 (1/48 s, f-number and ISO from the
exposure program):

| View | Metered EV | Settings | EV100 | ISS reference |
| --- | ---: | --- | ---: | ---: |
| Sunlit Earth, nadir | −0.74 | f/5.3, ISO 300 | 8.8 | +14.9 to +16.3 |
| City lights, nadir | +0.43 | f/4.1, ISO 394 | 7.7 | −3.7 |
| Night limb | +5.10 | f/3.2, ISO 6 139 | 3.0 | −4.0 |

The day offset (~7 stops) is only our virtual sensor's sensitivity and can
be calibrated away. The spread is the finding: a real camera goes ~20 stops
from day to night; ours goes 1–6, and the remaining 14–18 stops are built
into the night emitters, matching their 10⁴–10⁵ factors. A low-light video
camera at its limits, f/1.4, 1/24 s, ISO 409 600, reaches EV100 −6.5, past
the ISS night stills at −4. Physical night radiances are therefore
reachable in 24 fps video. At that limit the mid-grey luminance is
12.5 × 2^EV100/100 ≈ 1.4 × 10⁻³ cd/m², about the bright Milky Way, so even it
stays visible, though in heavy noise.

## Next steps

1. Fix the Moon (×200): its disk radiance disagrees with the irradiance the
   same code assigns to moonlight (`fullMoonIrradiance`).
2. Make star flux independent of window size.
3. Extend the camera: a calibrated sensitivity so EV100 matches the ISS
   frames, shutter to 1/24 s, a fast lens, ISO to ~400 000 with a sensor
   noise model fitted to high-ISO video, and automatic exposure across the
   ~22-stop span.
4. Bring the night emitters to physical values one at a time, moving the
   camera rather than the emitters, and compare on the reference views.
5. Keep the Milky Way's current look as an explicit, documented gain.

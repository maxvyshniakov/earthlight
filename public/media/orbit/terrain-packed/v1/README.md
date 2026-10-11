# Prepared Copernicus terrain, format 1

These optional `.dem` files contain gzip-compressed ELDEM001 containers of
four packed RGBA terrain patches. They use the same height quantization,
regridding, gutters and numeric mip levels as the live TIFF decoder. The
compression and container introduce no further approximation.

The extension is deliberately `.dem`: serving `.gz` can add Content-Encoding
and cause a browser to decompress the payload before the worker sees it.

`manifest.json` records the covered parent IDs, fixed public source URLs,
source checksums, compressed checksums and decoded checksums. Coverage can be
partial; areas without prepared data continue to use the GLO-90 TIFF source.
Generate an explicit selection with `bun run terrain:prepare --ids-file ids.json`.
Generated binary data and manifests are not committed to source control.

Produced using Copernicus WorldDEM-90 © DLR e.V. 2010-2014 and
© Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by
the European Union and ESA; all rights reserved.

See [the asset provenance](../../README.md) for the source dataset and credits.

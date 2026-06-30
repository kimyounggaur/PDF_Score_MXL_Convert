# Audiveris Container

Audiveris is AGPL-3.0. This project invokes it only as an independent CLI subprocess.

```bash
docker build -f docker/Dockerfile.audiveris -t omr-audiveris .
docker run --rm omr-audiveris audiveris -help
docker run --rm \
  -v "$PWD/samples:/work/in" \
  -v "$PWD/out:/work/out" \
  omr-audiveris \
  bash /docker/run-audiveris.sh /work/in/sample.pdf /work/out
find out -name '*.mxl' -exec sh -c 'printf "%s -> " "$1"; head -c 4 "$1" | xxd' _ {} \;
```

The default `AUDIVERIS_TAG` is `5.10.2`. Recheck Audiveris releases before production builds.

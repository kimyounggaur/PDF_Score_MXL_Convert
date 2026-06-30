> 📋 **Phase 0 단독 발췌** — v2 설계서에서 이 Phase만 떼어낸 복붙용 파일입니다.
> 첫 Phase를 시작할 땐 먼저 `00_공통_먼저-붙여넣기.md`(전제·절대 규칙·정확도 원칙·아키텍처·데이터 모델)를 AI에 함께 전달하세요.
> 전체 문서: `PDF-to-MXL-웹앱-바이브코딩-프롬프트(v2_정확도_강화판).md`

### Phase 0 — 인프라: Audiveris 실행 컨테이너 (최우선)

이 앱의 정확도와 안정성은 전부 "Audiveris가 컨테이너 안에서 재현 가능하게 도는가"에서 출발한다. Phase 0이 흔들리면 그 위 모든 Phase가 무너지므로, **여기서는 UI도 API도 만들지 않고 오직 도커 이미지 하나가 `sample.pdf → sample.mxl`을 뱉어내게 하는 것**에만 집중한다.

리서치로 확정된 사실:
- Audiveris 최신 안정 버전은 **5.10.x 대**(원본 설계서의 5.4는 구버전). 5.5부터 OS별 설치 프로그램에 **JRE가 번들**되며, 최근 빌드는 **Java 24~25 + Gradle 9.x**를 사용한다. 소스 빌드 시 JDK가 필요하다.
- 검증된 배치 플래그: `-batch`, `-transcribe`, `-export`(transcribe 포함), `-output <DIR>`, `-sheets`, `-step`, `-force`, `-save`, `-swap`, `-constant KEY=VALUE`(구명칭 `-option`도 지원). 입력은 **PDF/TIFF/JPG/PNG/BMP** 직접 가능.
- OCR은 **Tesseract 라이브러리**로 호출되며 **tessdata 언어 파일 + `TESSDATA_PREFIX` 경로**가 핵심. 리눅스 빌드에서 "No OCR is available" 오류가 잦으니 언어팩과 경로를 반드시 검증한다.

아래는 그대로 붙여넣는 프롬프트다.

```text
[프롬프트 — Phase 0] Audiveris OMR 실행 컨테이너 구축

(이 프롬프트와 함께 §1 전제·절대 규칙, §2 아키텍처·파이프라인, §3 데이터 모델·폴더 구조를 먼저 읽어라.)

# 목표
Audiveris 5 CLI를 헤드리스(batch)로 실행하는 단일 Docker 이미지를 만든다.
이 단계에서는 웹/API/워커 코드를 만들지 말고, 컨테이너 안에서
sample.pdf -> sample.mxl 변환이 재현되는 것만 보장한다.

# 절대 규칙(재확인)
- Audiveris는 서버 사이드 subprocess로만 실행한다(브라우저/서버리스 직접 실행 금지).
- Audiveris는 AGPLv3다. 우리 코드와 링크하지 말고, 독립 바이너리를 CLI로 호출(subprocess)만 한다.

# 베이스 이미지 & 패키지
- 베이스: eclipse-temurin:21-jdk (Debian 계열). 빌드가 더 높은 JDK를 요구하면
  에러 메시지에 맞춰 21->24 등으로 올린다(아래 "버전 주의" 참고).
- apt-get으로 설치: git, tesseract-ocr, tesseract-ocr-eng, poppler-utils,
  fontconfig, fonts-freefont-ttf, libfreetype6, ca-certificates, unzip.
  (poppler-utils는 이후 Phase 0.5/2의 pdftoppm/pdfimages/pdffonts에 쓴다.)
- 한국어 가사 악보까지 노린다면 tesseract-ocr-kor도 추가(언어 많을수록 OCR이 느려지니 필요한 것만).

# Audiveris 설치 (소스 빌드 경로 — 가장 재현성 높음)
- 공식 저장소를 클론하고 gradle wrapper로 빌드한다:
    git clone --depth 1 --branch <확인된_안정_태그> https://github.com/Audiveris/audiveris.git /opt/audiveris-src
  * <확인된_안정_태그>는 https://github.com/Audiveris/audiveris/releases 에서 최신 안정 태그를 확인해 박아 넣어라(예: 5.x 형식). 태그를 추측하지 말 것.
- 빌드:
    cd /opt/audiveris-src && ./gradlew clean build -x test
  * gradlew가 요구하는 JDK 버전이 베이스보다 높으면 베이스 태그를 올린다(빌드 로그가 정확히 알려준다).
- 빌드 산출물에서 실행 가능한 배포본을 만든다:
    ./gradlew distZip   (또는 installDist)
  * 산출 zip을 /opt/audiveris 에 풀고, 실행 스크립트 경로(bin/Audiveris)를 확인한다.
  * distZip/installDist 산출 경로는 build/distributions/ 또는 build/install/ 아래다. 실제 생성 경로를 ls로 확인하고 박아라(추측 금지).

# PATH 래퍼
- /usr/local/bin/audiveris 에 래퍼 스크립트를 만들어 환경변수까지 고정한다:
    #!/usr/bin/env bash
    exec java \
      -Djava.awt.headless=true \
      -Xmx2g \
      -jar /opt/audiveris/lib/audiveris.jar "$@"
  * 실제 배포본이 'bin/Audiveris' 런처를 제공하면 그 런처를 호출하는 형태로 바꿔라.
    (런처 내부에서 이미 클래스패스를 구성하므로 -jar 대신 'exec /opt/audiveris/bin/Audiveris "$@"' 가 더 안전)
  * chmod +x 로 실행권한 부여.
- 목적: 어디서 호출하든 'audiveris -batch -export ...' 한 줄로 동작하게 만든다.

# Headless / 폰트
- 반드시 -Djava.awt.headless=true 로 실행(GUI 없는 컨테이너에서 AWT 초기화 충돌 방지).
- fontconfig + fonts-freefont-ttf 를 설치해 심볼/폰트 누락으로 인한 렌더 예외를 예방한다.
  (Audiveris가 fontconfig/freefont에 의존한다는 공식 명문은 미확인이나, 헤드리스 Java 컨테이너의
   일반적 폰트 누락 문제를 막는 안전책이다.)

# OCR 경로
- ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata
  * 이 경로는 베이스 이미지의 tesseract 버전에 따라 다르다. 컨테이너에서
    'dpkg -L tesseract-ocr-eng | grep tessdata' 로 eng.traineddata 실제 위치를 확인해 박아라(추측 금지).
- 빌드 후 컨테이너 안에서 'audiveris -help'가 OCR 경고 없이 떠야 한다.

# 산출물 파일
- /docker/Dockerfile.audiveris
- /docker/run-audiveris.sh   (입력 PDF 경로와 출력 폴더를 받아 audiveris -batch -export 를 호출하는 헬퍼)
- /samples/sample.pdf        (간단한 단성부 1~2페이지 악보. 없으면 더미 안내 주석)
- /docker/README.md          (build/run 명령, 버전 주의, 라이선스 주의)

# run-audiveris.sh 사양
- 인자: $1=입력 PDF 절대경로, $2=출력 디렉터리(잡 폴더)
- 실행:
    audiveris -batch -export -output "$2" -- "$1"
  * -export 는 -transcribe 를 암시적으로 포함한다(중복 지정 불필요).
  * 멀티 movement면 .mxl 이 여러 개 생성될 수 있음을 stdout에 경고로 남겨라(상세 처리는 Phase 1).
- 출력 폴더 안에 <radix>/<radix>.mxl 형태로 떨어지는지 ls로 확인하는 라인 포함.

# 검증 스텝(빌드 마지막에 self-check)
1) audiveris -help 가 정상 출력 & "No OCR is available" 류 경고 없음.
2) run-audiveris.sh 로 sample.pdf -> sample.mxl 생성.
3) 생성된 .mxl 의 첫 4바이트가 zip 시그니처(PK\x03\x04)인지 확인(file 또는 hexdump).

# 버전 주의(중요)
- 추측한 태그/플래그/JDK 버전을 단정하지 말 것. 다음은 반드시 실제 확인:
  * Audiveris 안정 태그 -> releases 페이지
  * gradlew가 요구하는 JDK -> 빌드 로그
  * TESSDATA_PREFIX 실제 경로 -> dpkg -L
  * 배포본 실행 런처 경로 -> build/distributions 또는 build/install 아래 ls
- 위 4개는 "확인 후 박아넣기". 확인 전에는 코드에 TODO 주석으로 남겨라.
```

**산출물**
- `/docker/Dockerfile.audiveris`
- `/docker/run-audiveris.sh`
- `/samples/sample.pdf`
- `/docker/README.md` (build/run 명령, 버전·경로 확인 체크리스트, AGPLv3 주의)

**완료 판정**(전부 체크되어야 다음 Phase로)
- [ ] `docker build -f docker/Dockerfile.audiveris -t omr-audiveris .` 가 에러 없이 성공한다.
- [ ] 컨테이너 안에서 `audiveris -help` 가 정상 출력되고 **"No OCR is available" 경고가 없다**.
- [ ] `run-audiveris.sh` 로 `sample.pdf → <radix>.mxl` 가 생성된다.
- [ ] 생성된 `.mxl` 첫 4바이트가 `50 4B 03 04`(PK 시그니처)다.
- [ ] 그 `.mxl` 를 **MuseScore에서 열어 악보가 표시**된다(사람이 1회 육안 확인).

> AGPLv3 주의: Audiveris는 AGPL-3.0이다. 우리 애플리케이션 코드와 정적/동적 링크하지 말고, **독립 실행 바이너리를 CLI subprocess로만 호출**한다(이 경계가 라이선스 안전선이다).

**검증 명령**(복붙 가능)
```bash
# 1) 이미지 빌드
docker build -f docker/Dockerfile.audiveris -t omr-audiveris .

# 2) CLI & OCR 헬스체크 (OCR 경고가 없어야 정상)
docker run --rm omr-audiveris audiveris -help

# 3) 샘플 변환 (호스트의 /samples 를 마운트해 결과를 host에 받음)
docker run --rm \
  -v "$PWD/samples:/work/in" \
  -v "$PWD/out:/work/out" \
  omr-audiveris \
  bash /docker/run-audiveris.sh /work/in/sample.pdf /work/out

# 4) 산출물 확인: .mxl 존재 + zip(PK) 시그니처 확인
ls -R out
# PK\x03\x04 == 50 4b 03 04 이면 정상 .mxl
find out -name '*.mxl' -exec sh -c 'printf "%s -> " "$1"; head -c 4 "$1" | xxd' _ {} \;
```

**정확도 영향**: 직접적 정확도 향상은 없지만 **재현성의 토대**다. 특히 `TESSDATA_PREFIX`/언어팩이 빠지면 가사·텍스트 OCR이 통째로 죽어 이후 Claude 보정이 메울 수 없는 구멍이 생긴다. 여기서 OCR 헬스체크를 통과시키는 것이 가사 정확도의 하한선을 지킨다.

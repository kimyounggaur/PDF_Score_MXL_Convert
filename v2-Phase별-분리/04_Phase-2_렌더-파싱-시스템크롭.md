> 📋 **Phase 2 단독 발췌** — v2 설계서에서 이 Phase만 떼어낸 복붙용 파일입니다.
> 첫 Phase를 시작할 땐 먼저 `00_공통_먼저-붙여넣기.md`(전제·절대 규칙·정확도 원칙·아키텍처·데이터 모델)를 AI에 함께 전달하세요.
> 전체 문서: `PDF-to-MXL-웹앱-바이브코딩-프롬프트(v2_정확도_강화판).md`

### Phase 2 — 렌더 + MusicXML 파싱/마디 분할 + 시스템 단위 크롭 (v2 핵심)

이 단계가 **v2 전체의 정확도 엔진**이다. Phase 3에서 Claude Vision이 보는 이미지의 품질과 "그 이미지가 MusicXML의 어느 마디에 대응하는지"가 여기서 결정된다. 리서치가 분명히 말한다: **Claude는 빽빽한 작은 음표 카운팅에 약하고, 큰 이미지는 다운스케일되어 작은 음표가 뭉개진다.** 그래서 페이지 전체를 통째로 보내는 대신 **시스템(보표 줄) 단위로 잘라서** 보낸다. 작게 자를수록 음표 대조 정확도가 오른다.

세 가지를 만든다: (a) PDF→고해상 페이지 PNG 렌더 + Claude 입력용 리사이즈 사본, (b) `.mxl` 해제→MusicXML 파싱→`parts[].measures[]` 구조화 + 페이지↔마디 매핑, (c) **시스템 단위 좌표 크롭**과 그 좌표 영속화. (c)가 이 Phase의 심장이다.

```text
[프롬프트 — Phase 2]
역할: 너는 Node.js/TypeScript 백엔드 엔지니어다. UI 없음. 세 모듈을 만든다:
/worker/src/render.ts, /worker/src/musicxml.ts, /worker/src/systems.ts.

============ (a) 렌더: /worker/src/render.ts ============
export interface RenderedPage {
  pageNumber: number;            // 1-based
  fullPngPath: string;           // 고해상 원본(보관용)
  visionPngPath: string;         // Claude 입력용 리사이즈 사본
  width: number; height: number; // visionPng 픽셀 치수
}

export async function renderPages(
  inputPdfPath: string,
  jobDir: string,
  opts?: { dpi?: number; visionMaxEdge?: number }
): Promise<RenderedPage[]>;

규칙:
- poppler의 pdftoppm로 300dpi(opts.dpi ?? 300) PNG 렌더:
    pdftoppm -png -r 300 <input.pdf> <jobDir>/pages/page
  → page-01.png, page-02.png ... ( -png 은 자동 zero-pad ). 페이지 수를 세서 반환.
- 고해상 원본은 pages/page-NN.png 로 보관(절대 덮어쓰지 마라 — 좌표 크롭의 진실 원본).
- Claude 입력용 리사이즈: 긴 변이 opts.visionMaxEdge(기본 1568)를 초과하면 sharp로
  비율 유지 다운스케일한 사본을 pages/vision/page-NN.png 로 저장. 초과 안 하면 원본 복사.
  ※ 근거: standard 티어 모델(claude-sonnet-4-6)은 긴 변 1568px로 자동 다운스케일된다.
    너무 줄이면 음표가 뭉개지니, "페이지 전체"는 1568, "시스템 크롭"은 더 크게 보낼 수 있다
    (크롭은 면적이 작아 같은 px에서도 음표가 더 큼). high-res 티어(claude-opus-4-8)는 2576px.
- 반환 배열은 pageNumber 오름차순.

============ (b) 파싱: /worker/src/musicxml.ts ============
export interface MeasureRef {
  measureNumber: string;   // <measure number="..."> 그대로(문자열, "1","2","X1" 등 가능)
  partId: string;          // <part id="...">
  index: number;           // 해당 part 내 0-based 순번
  startsNewSystem: boolean;// 이 measure의 <print new-system="yes">
  startsNewPage: boolean;  // <print new-page="yes">
  node: unknown;           // fast-xml-parser 원시 노드 참조(직접 편집/좌표 추출용)
}
export interface ParsedScore {
  scoreType: "partwise" | "timewise";
  parts: { partId: string; measures: MeasureRef[] }[];
  rootDoc: unknown;        // preserveOrder 파싱 트리 전체(재직렬화용)
  millimeters?: number;    // <defaults><scaling><millimeters>
  tenths?: number;         // <defaults><scaling><tenths>  (tenths→mm 환산용)
}

export async function unzipMxl(mxlPath: string, outDir: string): Promise<string>;
//  .mxl(zip) 해제 → META-INF/container.xml 의 첫 <rootfile full-path>를 읽어
//  실제 MusicXML 파일의 절대경로를 반환. (rootfile 경로를 추측하지 말고 container.xml에서 읽어라)

export async function parseMusicXml(musicxmlPath: string): Promise<ParsedScore>;
//  fast-xml-parser를 preserveOrder:true, ignoreAttributes:false 로 파싱.
//  (preserveOrder 필수: note 자식은 고정 순서라 순서 보존 안 하면 Phase 4 재직렬화 때 스키마가 깨진다.)
//  score-partwise / score-timewise 판별. parts[].measures[] 채우기.
//  각 measure의 첫 <print> 요소에서 new-system/new-page 속성을 읽어 플래그 세팅.
//  <defaults><scaling>의 millimeters/tenths 추출(있으면).

export interface PageMeasureMap {
  pageNumber: number;
  // 이 페이지에 속한 (partId, measureNumber) 쌍들
  measures: { partId: string; measureNumber: string }[];
}
export function mapPagesToMeasures(score: ParsedScore, pageCount: number): PageMeasureMap[];
//  규칙: <print new-page="yes">가 나오는 measure에서 페이지 번호를 +1.
//   - 첫 measure는 page 1에서 시작.
//   - new-page 마커가 전혀 없으면(흔함): 전부 page 1로 두되, pageCount>1이면
//     "좌표 매핑은 systems.ts(이미지 기반)로 보강 필요" 플래그를 로그로 남겨라.
//  주의: MusicXML은 measure의 픽셀 박스를 직접 주지 않는다. 페이지 경계는 new-page로,
//   더 세밀한 위치는 systems.ts가 책임진다.

============ (c) v2 핵심: 시스템 단위 크롭 /worker/src/systems.ts ============
export interface SystemBox {
  systemId: string;        // 예: "p1-s1" (page1, system1)
  page: number;            // 1-based
  bbox: { x: number; y: number; w: number; h: number }; // 고해상 원본 PNG 픽셀 좌표
  measureRange: { partId: string; from: string; to: string }[]; // 이 시스템에 걸친 마디 범위
  source: "musicxml" | "image"; // 좌표를 어느 경로로 얻었는지
};

export async function sliceSystems(
  pages: RenderedPage[],
  score: ParsedScore,
  jobDir: string,
  opts?: { method?: "musicxml" | "image" | "auto" }
): Promise<SystemBox[]>;

좌표 산출은 두 경로를 모두 구현하고 auto로 폴백:

경로(i) MusicXML 기반 (method="musicxml"):
  - <defaults><scaling>의 millimeters/tenths로 tenths→mm 환산 비율을 구하고,
    pages[].width(픽셀)/페이지 폭(mm 또는 tenths)로 tenths→픽셀 스케일을 구한다.
  - <print new-system="yes"> 가 시스템 경계. 각 시스템 묶음의 상/하단 y는
    system-layout/staff 위치(default-y, system-distance 등 tenths)를 누적해 계산.
  - 단, default-x/default-y/width 가 생략된 파일이 흔하다(OMR 산출물은 신뢰도 편차 큼).
    값이 없으면 이 경로는 포기하고 경로(ii)로 폴백.

경로(ii) 이미지 처리 기반 (method="image", 폴백 기본):
  - 고해상 원본 PNG에 대해 수평 투영 프로파일(행별 흑 픽셀 합)을 구한다.
  - 피크 군집 = 보표선(staff line). 5선 묶음 = 하나의 staff, 인접 staff 묶음 = 하나의 system.
  - 각 system의 상/하단 y에 여백(예: interline의 4~6배)을 더해 bbox를 만든다. x는 페이지
    좌우 마진 추정(좌측 첫 검은 픽셀 ~ 우측 끝)으로.
  - ※ 수평 투영은 스큐(기울기)에 민감하다. Phase 0.5에서 deskew를 먼저 했다고 가정하되,
    안 됐으면 정확도가 떨어질 수 있음을 로그로 경고하라.
  - 구현: sharp로 grayscale+raw 픽셀 추출 후 JS로 투영 계산(외부 OpenCV 없이 가능).
    OpenCV(opencv4nodejs 등)를 쓸 수 있으면 morphology로 보표선 검출을 강화해도 좋다(선택).

method="auto"(기본): 경로(i)에 필요한 좌표(scaling+default-y 등)가 충분하면 (i),
  부족하면 (ii)로 폴백. 각 SystemBox.source에 실제 사용 경로를 기록.

영속화:
  - 각 시스템을 고해상 원본에서 crop하여 <jobDir>/systems/system-<id>.png 로 저장.
    (Claude 입력용으로 너무 크면 긴 변 기준 리사이즈 사본도 함께. 단 크롭은 면적이 작아
     같은 px에서도 음표가 크므로 페이지 전체보다 공격적으로 줄이지 마라.)
  - 전체 매핑을 <jobDir>/coords.json 으로 저장:
      { systems: SystemBox[], pages: PageMeasureMap[] }
    이 coords.json이 Phase 3 대조의 1차 근거다(systemId → 이미지 + 마디 범위).

테스트(systems.test.ts / musicxml.test.ts):
- parseMusicXml: 샘플 .mxl에서 parts.length>0 이고 각 part의 measures.length>0.
- unzipMxl: container.xml의 rootfile을 읽어 .musicxml 경로를 반환하고, 그 파일이 존재.
- mapPagesToMeasures: 반환 배열이 비어있지 않고, 모든 measure가 정확히 한 페이지에 배정됨
  (어느 measure도 0개 페이지/2개 페이지에 중복 배정되지 않음).
- sliceSystems: 반환 SystemBox 개수가 합리적 범위(1 <= systems <= 마디 총수)이고,
  각 bbox가 페이지 치수 안에 들어오며(0<=x, x+w<=pageWidth 등), systems/*.png 파일이
  개수만큼 생성됨. 좌표가 음수/페이지 초과면 실패.
```

**산출물**
- `/worker/src/render.ts` — `renderPages()`(고해상 보관 + vision 리사이즈 사본).
- `/worker/src/musicxml.ts` — `unzipMxl()`, `parseMusicXml()`, `mapPagesToMeasures()`(+ `MeasureRef`/`ParsedScore` 타입).
- `/worker/src/systems.ts` — `sliceSystems()`(2경로+auto 폴백), `systems/system-*.png`, `coords.json` 영속화.
- 테스트: `musicxml.test.ts`, `systems.test.ts`.

**완료 판정** (전부 체크 가능해야 통과)
- [ ] `renderPages()`가 `pages/page-NN.png`(고해상 원본)와 `pages/vision/page-NN.png`(긴 변 ≤ 1568px 사본)를 페이지 수만큼 만든다.
- [ ] `unzipMxl()`이 `META-INF/container.xml`의 **첫 `<rootfile full-path>`**를 읽어 실제 MusicXML 경로를 반환한다(경로 추측 금지).
- [ ] `parseMusicXml()` 결과에서 `parts.length > 0`, 모든 part의 `measures.length > 0`, `scoreType`이 `partwise`/`timewise` 중 하나다.
- [ ] `mapPagesToMeasures()` 결과가 비어있지 않고, **모든 마디가 정확히 한 페이지에 배정**된다(0개/중복 배정 없음).
- [ ] `sliceSystems()`가 `coords.json`과 `systems/system-*.png`를 생성하고, 시스템 개수가 `1 ≤ systems ≤ 총 마디수` 범위이며, **모든 bbox가 페이지 픽셀 치수 안**에 든다(음수·초과 없음).
- [ ] 각 `SystemBox`에 `source`("musicxml"|"image")가 기록되어, 어떤 좌표 경로로 잘렸는지 추적 가능하다.
- [ ] `npm test` 통과(파싱/매핑/크롭 케이스).

**정확도 영향**
- **시스템 단위 크롭이 v2 정확도의 핵심**: 리서치가 명시한 Claude 비전의 한계 — "작은 객체가 많을수록 카운팅 부정확", "큰 이미지는 다운스케일되어 작은 음표가 뭉개짐" — 를 정면으로 회피한다. 페이지 전체 대신 보표 줄 하나만 보내면 같은 토큰 예산에서 **음표가 훨씬 크게** 보여 대조 정확도가 급상승한다. 이것이 Phase 3 보정 품질의 상한을 결정한다.
- **`preserveOrder:true` 필수**: `<note>`의 자식은 `(pitch|rest) → duration → ... → notations → lyric → ...` **고정 순서**다. `<harmony>`도 `(root|numeral) → kind(필수) → inversion? → bass? → degree*` 고정 순서다. 순서를 보존하지 않고 파싱·재직렬화하면 **MusicXML XSD 검증이 깨진다**(Phase 4 롤백 유발). 여기서 순서를 지켜야 Phase 4의 패치가 살아남는다. (리서치 확인)
- **좌표 신뢰도 편차 인정**: MusicXML은 measure의 픽셀 박스를 직접 주지 않으며, OMR 산출물은 `default-x/y`·`width`를 생략하거나 추정값이라 신뢰도 편차가 크다. 그래서 **이미지 처리 경로(수평 투영/보표선 검출)를 기본 폴백**으로 둔다. 단 수평 투영은 **스큐에 민감**하므로 Phase 0.5의 deskew가 선행돼야 정확하다. (리서치 확인)
- **고해상 원본 보존**: 크롭과 좌표 계산의 진실 원본은 항상 `pages/page-NN.png`(300dpi)다. Claude로 보내는 리사이즈 사본과 분리 보관해야, 좌표가 어긋나거나 더 크게 다시 자를 필요가 생겨도 원본에서 재크롭할 수 있다.
- **DPI 300의 근거**: 두 보표선 간격(interline)이 약 20px가 되는 300dpi(A4)가 OMR/대조 모두의 표준 적정선. 작은 기호가 많으면 400dpi까지 올려 크롭 선명도를 높일 수 있다(메모리/시간과 트레이드오프). (리서치 확인)

**검증 명령**
```bash
# 1) 렌더: 고해상 원본 + vision 사본이 생기는지
npm run dev:render -- samples/sample.pdf   # render.ts 단독 CLI(있으면). 없으면 테스트로 대체
ls pages/ pages/vision/                     # page-01.png ... 가 보이면 OK

# 2) vision 사본의 긴 변이 1568 이하인지 확인(sharp metadata 또는 file 명령)
#    (테스트에서 width/height 단언으로 자동화 권장)

# 3) 파싱 + 매핑 + 크롭 일괄 테스트
npm test -- musicxml
npm test -- systems

# 4) coords.json 육안 점검: systemId/page/bbox/measureRange가 채워졌는지
cat <jobDir>/coords.json | jq '.systems[0]'

# 5) 크롭 결과 육안 확인: 보표 줄 하나가 깔끔히 잘렸는지
ls <jobDir>/systems/      # system-p1-s1.png ... 를 열어 보표 1줄이 들어왔는지 확인
```

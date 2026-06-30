> 📋 **Phase 4 단독 발췌** — v2 설계서에서 이 Phase만 떼어낸 복붙용 파일입니다.
> 첫 Phase를 시작할 땐 먼저 `00_공통_먼저-붙여넣기.md`(전제·절대 규칙·정확도 원칙·아키텍처·데이터 모델)를 AI에 함께 전달하세요.
> 전체 문서: `PDF-to-MXL-웹앱-바이브코딩-프롬프트(v2_정확도_강화판).md`

### Phase 4 — 보정 적용 + 강화된 검증 + MXL 재생성

이 단계가 "리포트만 뱉는 도구"와 "진짜 변환 앱"을 가른다. Phase 3의 보정 JSON을 **실제 MusicXML에 반영**하고, 두 겹의 검증을 통과한 것만 `.mxl`로 재압축한다. **절대 규칙은 단 하나다: 검증이 깨지면 보정을 버리고 Audiveris 원본 `.mxl`을 반환한다. 잘못된 보정 > 무보정.**

두 모드를 둔다.

| 모드 | 동작 | 기본값 | 안전성 |
|---|---|---|---|
| `REPORT` | XML 불변. `report.json`에 "이 마디에 코드 누락" 식으로만 기록. 원본 `.mxl` 그대로 반환 | ✅ 기본 | 절대 안전 (XML 안 건드림) |
| `AUTO_PATCH` | `missing_chords` → `<harmony>` 삽입, `missing_lyrics` → `<lyric><text>`, `wrong_notes` → `<pitch>` 교체. fast-xml-parser로 raw XML 재생성 | 옵션 | 위험 → 2중 검증 필수 |

`AUTO_PATCH`를 켜더라도 검증 게이트가 막아서면 자동으로 `REPORT` 수준(원본 반환 + 경고)으로 강등된다. 사용자는 항상 "열리는 `.mxl`"을 받는다.

#### Phase 3 → Phase 4 연결: 시스템 보정 결과를 페이지 단위로 정규화 (어댑터)

Phase 3는 *시스템(보표 줄) 단위*로 `report_corrections`(`measure`·`expected_pitch`·`got_pitch` …)를 돌려주고, Phase 4의 `applyCorrections`는 *페이지 단위* `PageVerifyResult`(`partId`·`noteIndex`·`expected`·`got` …)를 입력으로 받는다. 단위와 필드가 다르므로 **둘 사이를 잇는 어댑터를 하나 둔다 — Phase 2의 `coords.json`이 이 변환의 유일한 근거다.** (이 어댑터가 없으면 "시스템 결과"를 "페이지 패치"로 안전하게 옮길 수 없다.)

```ts
// /worker/src/adapt.ts — 시스템 보정 결과 → 페이지 단위 PageVerifyResult
export function toPageVerifyResults(
  systemResults: { systemId: string; correction: Correction }[],  // Phase 3 산출(시스템 단위)
  coords: Coords,        // Phase 2 산출: systemId → { page, measureRange:[{partId, from, to}] }
  score: ParsedScore,    // Phase 2 산출: measure→note 인덱스 해석용
): PageVerifyResult[];
//  매핑 규칙:
//   - systemId → page, partId : coords.json의 measureRange로 해석(이 시스템이 어느 part/마디인지).
//   - measure 검증 : Claude가 답한 절대 마디 번호가 그 시스템의 measureRange 안에 있는지 확인.
//                    범위 밖이면 그 항목은 패치하지 말고 needs_human으로 표시(함정 13).
//   - expected_pitch/got_pitch → expected/got 으로 필드명 정규화.
//   - noteIndex 해석 : wrong_notes는 해당 measure 안에서 got_pitch와 일치하는 음표를 찾아 인덱스 부여
//                     (동일 음높이가 여럿이면 박/위치로 보강, 끝내 모호하면 needs_human).
//   - missing_lyrics.syllable_index → noteIndex(그 마디 n번째 음표)로 환산.
```

이 어댑터를 거친 뒤에야 `applyCorrections`가 `partId`·`noteIndex`로 정확한 노드를 찾아간다. **변환이 모호한 항목은 패치하지 말고 `needs_human`으로 흘려보낸다**(Phase 4.5가 집계). 이로써 Phase 3의 "시스템 정확도"와 Phase 4의 "페이지 패치"가 좌표 한 줄(`coords.json`)로 안전하게 연결된다.

```text
[프롬프트 — Phase 4]
역할: 너는 OMR 파이프라인의 "보정 적용 + 검증 + 재압축" 단계를 만드는 백엔드 엔지니어다.
Phase 2(musicxml.ts: 파싱/마디 매핑)와 Phase 3(vision.ts: 보정 JSON)는 이미 있다고 가정한다.

목표: Phase 3가 만든 보정 JSON을 MusicXML에 적용하고, 2중 검증을 통과한 결과만 표준 .mxl로 재압축한다.
절대 규칙: 어느 검증이든 실패하면 보정을 폐기하고 Audiveris 원본 .mxl + 경고를 반환한다. (잘못된 보정 > 무보정)

== 산출물 ==
1) /worker/src/apply.ts
2) /worker/src/sanity.ts
3) /worker/src/validate.ts
4) /worker/src/mxl.ts
5) 각 파일 단위테스트(특히 "의도적으로 깨지는 패치 → 롤백되어 원본 반환" 케이스)

== 공통 타입 (Phase 3와 일치시킬 것) ==
type PageVerifyResult = {
  page: number;
  missing_chords: { measure: number; partId: string; chord: string; beat?: number }[];
  missing_lyrics: { measure: number; partId: string; noteIndex: number; text: string; syllabic?: "single"|"begin"|"middle"|"end" }[];
  wrong_notes:    { measure: number; partId: string; noteIndex: number; expected: string; got: string }[];
  confidence: "high" | "medium" | "low";
};
// expected/got 음표 표기는 "C#5" 형태(step+alter+octave). 파서가 step/alter/octave로 분해.

== apply.ts ==
export type ApplyMode = "REPORT" | "AUTO_PATCH";

export interface AppliedItem {
  kind: "chord" | "lyric" | "note";
  measure: number; partId: string;
  applied: boolean;            // 실제 XML에 반영됐는지
  reason?: string;             // 미적용 사유 (예: "measure not found", "confidence=low skip")
  before?: string; after?: string; // note 교체 시 before/after pitch
}

export interface ApplyResult {
  mode: ApplyMode;
  musicXml: string;            // 적용 후(또는 REPORT면 원본) MusicXML 문자열
  items: AppliedItem[];
}

export function applyCorrections(
  originalXml: string,
  results: PageVerifyResult[],
  mode: ApplyMode,
  opts?: { minConfidence?: "high"|"medium"|"low"; maxNotePatchesPerMeasure?: number }
): ApplyResult

규칙:
- mode==="REPORT": XML은 절대 수정하지 않는다. 모든 항목을 applied:false, reason:"REPORT mode"로 기록만.
- mode==="AUTO_PATCH": fast-xml-parser를 preserveOrder:true 로 파싱(요소 순서 보존 필수).
  - missing_chords → 해당 measure 안, 적용 대상 음표 바로 "앞"에 <harmony> 삽입.
    <harmony> 자식 순서 강제: root(<root-step>+<root-alter>?) → kind(필수) → bass?.
  - missing_lyrics → 해당 note의 <lyric><syllabic>?<text>… 삽입. lyric은 note 자식 중 notations "뒤", play "앞"에 위치.
  - wrong_notes → 해당 note의 <pitch>(step/alter/octave) 교체. before/after 기록.
  - confidence < minConfidence(기본 "medium")인 페이지의 wrong_notes는 건너뜀(applied:false, reason:"low confidence").
  - measure/partId/noteIndex로 대상을 못 찾으면 applied:false, reason 기록(throw 금지).
- 빌드 시 fast-xml-parser의 XMLBuilder로 다시 직렬화. DOCTYPE/xml 선언은 보존(수동 재삽입).

== sanity.ts (음악적 정합성) ==
export interface SanityReport {
  ok: boolean;
  checks: { name: string; ok: boolean; detail?: string }[];
}
export function musicalSanity(beforeXml: string, afterXml: string): SanityReport
검사 항목(전부 구현):
  1) 파트 수 보존: <part> 개수 동일.
  2) 마디 수 보존: 각 part의 <measure number> 개수·번호 연속성 동일.
  3) 각 마디 박자 합 == time signature:
     measure 내 note duration 합(backup/forward 반영) == divisions × beats × 4 / beat-type.
     (직전 <attributes>의 divisions/time을 상속 추적)
  4) 추가/삭제 노트 수 합리성: after의 <note> 총수가 before와 동일해야 함
     (AUTO_PATCH는 pitch 교체·harmony/lyric 삽입만 하므로 note 개수는 불변. 달라지면 ok:false).
  5) pitch 유효성: 교체된 step∈{A..G}, octave 정수, alter∈{-2..2}.
ok = 모든 check.ok.

== validate.ts (XSD 구조 검증) ==
export interface ValidationResult { ok: boolean; errors: string[]; tool: "xmllint"; }
export async function validateMusicXml(xmlPath: string): Promise<ValidationResult>
- xmllint --schema <로컬 musicxml.xsd> --noout <xmlPath> 를 child_process로 실행.
- 핵심: 배포 XSD의 xml.xsd import가 외부 URL을 가리켜 매우 느리므로, schemaLocation을 로컬 xml.xsd로 패치한 XSD를 /worker/xsd/ 에 둘 것. --nonet 으로 네트워크 차단.
- exit code 0이면 ok, 아니면 stderr를 errors[]에 라인 단위로.
- W3C MusicXML 4.0 XSD는 w3c/musicxml 배포본 사용. DTD는 4.0부터 deprecated이므로 XSD로.

== mxl.ts (표준 .mxl 재압축) ==
export async function repackMxl(musicXmlString: string, outPath: string): Promise<void>
표준 .mxl ZIP 레이아웃을 정확히 지킬 것(MuseScore/Finale 호환):
  - ZIP "첫 엔트리"는 정확히 "mimetype": 내용 "application/vnd.recordare.musicxml",
    STORED(비압축), extra field 없음, US-ASCII, BOM/선행공백 금지.
  - META-INF/container.xml: <rootfiles><rootfile full-path="score.musicxml"
      media-type="application/vnd.recordare.musicxml+xml"/></rootfiles>
  - score.musicxml: 본문(DEFLATE 압축 가능).
  - Node라면 yazl로 mimetype은 {compress:false}로 첫 추가, 나머지는 기본.

== 오케스트레이션 (이 단계의 결정 흐름) ==
function finalizeCorrection(originalXml, results, mode):
  applied = applyCorrections(originalXml, results, mode)
  if mode === "REPORT": return { xml: originalXml, downgraded:false, report... }   // 원본 그대로 .mxl
  san = musicalSanity(originalXml, applied.musicXml)
  write applied.musicXml to tmp; val = await validateMusicXml(tmp)
  if (san.ok && val.ok):
     repackMxl(applied.musicXml, corrected.mxl); return { xml: applied.musicXml, downgraded:false, ... }
  else:
     // 절대 규칙 발동: 보정 폐기
     repackMxl(originalXml, corrected.mxl)  // 원본을 표준 .mxl로
     return { downgraded:true, warning:"correction failed validation; returned Audiveris baseline",
              sanity:san, validation:val }

== report.json 스키마 ==
{
  "job_id": "...",
  "final_mode": "REPORT" | "AUTO_PATCH" | "AUTO_PATCH_DOWNGRADED",
  "validation": { "xsd_ok": bool, "errors": [..], "sanity_ok": bool,
                  "sanity_checks": [{name,ok,detail}] },
  "pages": [
    { "page": 1,
      "systems": [ { "system": 1, "measures": [1,2,3,4] } ],   // Phase 2 좌표 매핑 계승
      "applied":   [ {kind,measure,partId,after,confidence} ],
      "unapplied": [ {kind,measure,partId,reason,confidence} ]
    }
  ],
  "summary": { "chords_added":N, "lyrics_added":N, "notes_fixed":N, "skipped":N }
}

코드는 타입을 모두 명시하고, throw보다 "applied:false + reason" 로 그레이스풀하게 처리하라.
검증 실패 시 반드시 원본 .mxl이 사용자에게 가도록 하라.
```

**산출물**
- `/worker/src/apply.ts` — `applyCorrections(originalXml, results, mode, opts): ApplyResult`
- `/worker/src/sanity.ts` — `musicalSanity(beforeXml, afterXml): SanityReport`
- `/worker/src/validate.ts` — `validateMusicXml(xmlPath): Promise<ValidationResult>`
- `/worker/src/mxl.ts` — `repackMxl(musicXmlString, outPath): Promise<void>`
- `/worker/xsd/` — 로컬 패치된 `musicxml.xsd` + `xml.xsd`(외부 URL import 제거)
- 각 파일 단위테스트. 핵심 테스트: **고의로 박자 합을 깨는 패치를 넣고 → `finalizeCorrection`이 원본 `.mxl`을 반환하는지** 검증.

**완료 판정** (전부 체크 가능해야 함)
- [ ] `REPORT` 모드: 입력 XML과 출력 `.mxl` 내부 `score.musicxml`이 **바이트 차이 없음**(harmony/lyric/pitch 미변경).
- [ ] `AUTO_PATCH` 모드: 정상 입력에서 `missing_chords` → `.mxl` 안에 `<harmony>`가 정확한 measure·위치에 추가됨(OSMD에서 코드기호 보임).
- [ ] **롤백 테스트 통과**: 의도적으로 깨진 패치(예: 4/4 마디에 음표 1개 추가로 박자 합 위반) → `musicalSanity.ok===false` → 출력 `.mxl`이 **원본과 동일** + `final_mode:"AUTO_PATCH_DOWNGRADED"` + 경고.
- [ ] `validate.ts`가 일부러 망가뜨린 XML(닫는 태그 누락)에서 `ok:false` + 에러 라인 반환.
- [ ] 재압축 `.mxl`을 **MuseScore에서 직접 열어 깨지지 않음**, 그리고 `unzip -l`로 보면 **`mimetype`이 첫 엔트리이며 STORED**(압축 안 됨)임.
- [ ] `report.json`이 페이지/시스템별 applied·unapplied와 사유, 최종 모드, 검증 결과를 모두 담음.

**정확도 영향**
- 2중 검증(XSD + 음악적 sanity)은 **정확도를 직접 올리진 않지만, 보정이 만든 회귀(regression)를 0으로 만든다.** XSD만으로는 "박자 합이 안 맞는다" 같은 음악적 오류를 못 잡는다 — sanity 체크가 그 빈틈을 메운다. 결과적으로 "보정으로 더 나빠지는 경우"가 구조적으로 제거되어, refine 루프(Phase 4.5)의 단조 개선 가드가 신뢰할 수 있는 토대를 갖는다.
- `mimetype` 첫-엔트리·STORED 규약을 지키면 관대한 리더(MuseScore)뿐 아니라 엄격한 리더에서도 열려, "변환은 됐는데 안 열린다"는 최악의 사용자 경험을 차단한다.

**검증 명령** (복붙 가능)
```bash
# 1) XSD 구조 검증 (로컬 xml.xsd 패치본 사용, 네트워크 차단)
xmllint --noout --nonet --schema /worker/xsd/musicxml.xsd /work/<jobId>/corrected/score.musicxml \
  && echo "XSD OK" || echo "XSD FAIL"

# 2) .mxl ZIP 레이아웃 점검: mimetype이 첫 엔트리이고 STORED(=Stored)인지
unzip -l /work/<jobId>/corrected/score.mxl
unzip -v /work/<jobId>/corrected/score.mxl | grep -i mimetype   # Method 열이 "Stored"여야 함

# 3) 음악적 sanity + 롤백 단위테스트
npm test -- sanity.test.ts apply.test.ts mxl.test.ts

# 4) (선택) music21 라운드트립 — 파싱→재내보내기 후 마디/노트 수 보존 확인
python -c "from music21 import converter; s=converter.parse('/work/<jobId>/corrected/score.musicxml'); print('measures', len(s.parts[0].getElementsByClass('Measure')))"
```

> 📋 **Phase 3 단독 발췌** — v2 설계서에서 이 Phase만 떼어낸 복붙용 파일입니다.
> 첫 Phase를 시작할 땐 먼저 `00_공통_먼저-붙여넣기.md`(전제·절대 규칙·정확도 원칙·아키텍처·데이터 모델)를 AI에 함께 전달하세요.
> 전체 문서: `PDF-to-MXL-웹앱-바이브코딩-프롬프트(v2_정확도_강화판).md`

### Phase 3 — Claude Vision 보정 레이어 (구조화 출력 · 시스템 단위 대조 · 티어링)

이 단계가 v2의 핵심 차별점이다. Audiveris가 만든 구조 뼈대(baseline)를, **원본 악보 이미지를 ground truth로 삼아** Claude Vision으로 대조해 누락 코드기호·가사·명백한 오인식 음표를 구조화 JSON으로 회수한다. 여기서 만든 보정 JSON은 다음 Phase 4에서 MusicXML에 실제로 반영된다 — 사람용 리포트로 끝내지 않는다.

가장 중요한 설계 결정 하나: **입력 단위를 "페이지 전체"가 아니라 "시스템(보표 줄) 단위"로 좌표 크롭해서 보낸다.** 공식 문서가 명시한 두 가지 한계 때문이다.

1. `claude-sonnet-4-6`은 standard 해상도 티어라서 long edge가 1568px를 넘으면 **처리 전 자동 다운스케일**된다. 빽빽한 풀페이지 악보를 그대로 보내면 음표머리·임시표·작은 텍스트가 뭉개진다.
2. 공식 비전 문서가 "작은 객체가 많을 때 정확한 카운팅은 신뢰도가 낮다"고 명시한다. 한 줄(시스템) 단위로 잘라 밀집도를 낮추면 음표 대조 정확도가 급상승한다.

> Phase 2에서 만든 `systems/` PNG 크롭과 `coords.json`(픽셀 bbox ↔ partId+measureNumber 매핑)을 그대로 입력으로 쓴다. 좌표 자료구조가 없다면 Phase 2로 돌아가 먼저 만든다 — 이 단계의 정확도는 전적으로 그 매핑에 의존한다.

#### 환각 억제가 1순위 설계 목표다

OMR 보정에서 가장 위험한 실패 모드는 "Claude가 멀쩡한 부분을 틀렸다고 보고하고, Phase 4가 그걸 반영해 정상 음표를 망가뜨리는 것"이다. 따라서 프롬프트는 정확도보다 **환각 억제**를 먼저 설계한다. 핵심 기법 4가지:

| 기법 | 구현 |
|---|---|
| 역할 고정 | "원본 이미지가 진실(ground truth). Audiveris 데이터의 **오류만** 보고하라. 데이터가 이미지와 일치하면 아무것도 보고하지 마라." |
| 불확실 = 침묵 | "확실하지 않으면 보고하지 말고 `confidence`를 낮춰라. 추측 금지." |
| 작업 범위 한정 | "음표를 새로 발명하지 마라. 한 마디의 음표 개수를 세려 하지 마라(공식적으로 비전의 약점). 명백한 누락 코드/가사, 명백히 다른 음높이만 보고하라." |
| 구조화 출력 강제 | tool use 입력 스키마로 JSON 형태를 강제(자유 서술로 답하면 환각·preamble이 끼어든다). |

#### 구조화 출력은 tool use(strict)로 강제한다

공식 문서 기준, "system 프롬프트로 JSON-only 지시"는 가장 약한 방법(모델이 어기거나 preamble을 붙임)이다. 가장 견고한 것은 **스키마 강제**다. 두 선택지 모두 `claude-sonnet-4-6`/`claude-opus-4-8`에서 지원된다:

- **strict tool use**: 도구 정의에 `strict: true`(최상위 필드, `tool_choice`가 아님) + `input_schema`에 `additionalProperties: false` + `required`. `tool_use.input`이 스키마에 정확히 검증된다.
- 보정 결과를 "도구 호출 형태"로 받는 게 자연스러우므로 이 단계는 strict tool use를 채택한다.

스키마(시스템 1개당 반환):

```ts
// /worker/src/vision.ts 내 도구 정의
const VERIFY_TOOL = {
  name: "report_corrections",
  description:
    "원본 악보 이미지와 Audiveris 추출 데이터를 대조해 발견한 오류만 보고한다. " +
    "이미지가 진실이다. 확실하지 않으면 보고하지 말고 confidence를 낮춰라.",
  strict: true, // ← tool_choice가 아니라 도구 정의의 최상위 필드
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      missing_chords: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            measure: { type: "integer", description: "이 시스템의 실제 마디 번호" },
            beat: { type: "number", description: "코드가 놓이는 박(선택, 모르면 생략)" },
            chord: { type: "string", description: "예: Cmaj7, G/B, F#m7b5" },
          },
          required: ["measure", "chord"],
        },
      },
      missing_lyrics: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            measure: { type: "integer" },
            syllable_index: { type: "integer", description: "마디 내 음절 순서(선택)" },
            text: { type: "string" },
          },
          required: ["measure", "text"],
        },
      },
      wrong_notes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            measure: { type: "integer" },
            voice: { type: "integer", description: "성부(선택)" },
            staff: { type: "integer", description: "보표 번호(선택)" },
            expected_pitch: { type: "string", description: "이미지의 올바른 음, 예: C#5" },
            got_pitch: { type: "string", description: "Audiveris가 잘못 읽은 음" },
          },
          required: ["measure", "expected_pitch", "got_pitch"],
        },
      },
      extra_or_missing_notes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            measure: { type: "integer" },
            kind: { type: "string", enum: ["extra", "missing"] },
            pitch: { type: "string" },
          },
          required: ["measure", "kind"],
        },
      },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      notes: { type: "string", description: "자유 서술(선택, 디버깅용)" },
    },
    required: [
      "missing_chords",
      "missing_lyrics",
      "wrong_notes",
      "extra_or_missing_notes",
      "confidence",
    ],
  },
} as const;
```

`measure` 번호는 **그 시스템의 실제 마디 번호**로 답하게 한다. 프롬프트에 그 시스템이 포함한 마디 번호 목록(coords.json에서 추출)을 명시적으로 라벨링해 넣어, 모델이 "1번째 마디" 같은 상대 번호가 아니라 절대 번호로 답하도록 강제한다.

#### prompt caching · 모델 티어링 · (선택) Message Batches

- **prompt caching**: 변하지 않는 접두부(시스템 프롬프트=대조 규칙, 도구 스키마, 공통 지시)에 `cache_control: {type: "ephemeral"}`를 둔다. 렌더 순서는 `tools → system → messages`이며 접두 일치(prefix match)다. **시스템별로 바뀌는 부분(크롭 이미지·마디 목록·페이지 번호)은 마지막 브레이크포인트 뒤에 배치**한다. 캐시 가능 최소 길이는 모델별로 다르다 — `claude-sonnet-4-6` = 2048 토큰, `claude-opus-4-8` = 4096 토큰. 그보다 짧은 접두부는 오류 없이 조용히 캐시되지 않는다. 캐시 적중은 `usage.cache_read_input_tokens`로 검증(0이면 무효화 요인 의심: 시스템 프롬프트 내 `Date.now()`, 비결정적 JSON 직렬화, 가변 도구 셋).
- **모델 티어링**: 1차로 전 시스템을 `claude-sonnet-4-6`(input $3 / output $15 per MTok, standard 비전)로 검증한다. `confidence === "low"`이거나 `wrong_notes` 수가 임계치를 넘은 시스템만 `claude-opus-4-8`(input $5 / output $25, high-res 비전 2576px)로 재검증한다. Opus는 같은 고해상도 크롭에서 이미지당 visual token이 최대 ~3배 많을 수 있으니, 단가뿐 아니라 토큰 수 차이까지 비용 가드에 반영한다.
- **(선택) Message Batches**: 실시간이 아니라 "여러 시스템을 한꺼번에 채점"하는 워크로드이므로 Message Batches API가 비용·처리량 면에서 적합하다 — **모든 토큰 사용량 50% 할인**, 비전·tool use·caching 전부 지원. 대부분 1시간 내 완료(최대 24시간), 배치당 최대 100,000 요청/256MB. 단 **결과 순서 무보장 → 반드시 `custom_id`로 매칭**(시스템 인덱스를 custom_id에 인코딩). 잡 한 건의 지연(분 단위)이 허용된다면 배치를, 대화형 진행 표시가 필요하면 동기 Messages API를 쓴다. (Batches는 1P Claude API 전용 — Bedrock/Vertex 미지원.)

#### verifySystem 시그니처와 응답 파싱

```ts
// /worker/src/vision.ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // ANTHROPIC_API_KEY는 서버 환경변수에서만

export type Correction = Anthropic.Messages.ToolUseBlock["input"]; // 위 스키마 형태
export interface VerifyResult {
  correction: Correction;     // 파싱된 보정 JSON
  model: string;              // 실제 사용 모델 ID
  costUsd: number;            // 이 호출의 누적 비용
  raw: string | null;         // 파싱 실패 시 원시 텍스트 보관
  escalated: boolean;         // opus로 승격되었는지
}

export interface VerifyOpts {
  measureNumbers: number[];   // 이 시스템이 포함한 절대 마디 번호 목록
  model?: "claude-sonnet-4-6" | "claude-opus-4-8";
  maxRetries?: number;        // 기본 2
}

export async function verifySystem(
  systemImagePath: string,
  measuresJsonForSystem: object, // 이 시스템의 partId/measure/원시노드 요약
  opts: VerifyOpts,
): Promise<VerifyResult> {
  const model = opts.model ?? "claude-sonnet-4-6";
  const imageB64 = await readAsBase64(systemImagePath); // PNG, 양 변 2000px 이하 권장

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    tools: [VERIFY_TOOL],
    tool_choice: { type: "tool", name: "report_corrections" }, // 도구 호출 강제
    system: [
      {
        type: "text",
        text: VERIFY_SYSTEM_PROMPT,            // /worker/src/prompts/verify-system.ts
        cache_control: { type: "ephemeral" },  // ← 안정 접두부만 캐시
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          // ★ 이미지 블록을 텍스트보다 먼저 (공식 권장)
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: imageB64 },
          },
          {
            type: "text",
            text: buildUserPrompt(measuresJsonForSystem, opts.measureNumbers),
          },
        ],
      },
    ],
  });

  // 1차: tool_use 입력을 직접 사용 (strict 스키마로 검증됨)
  const toolUse = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
  );

  let correction: Correction | null = toolUse?.input ?? null;
  let raw: string | null = null;

  // 폴백: 어떤 이유로 tool_use가 없으면 text 블록에서 json 펜스 제거 후 파싱
  if (!correction) {
    raw = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    correction = tryParseJsonFence(raw); // 실패 시 raw 보관, correction은 null 가능
  }

  const costUsd = estimateCostUsd(model, response.usage); // 아래 비용 가드 참고
  return { correction: correction ?? EMPTY_CORRECTION, model, costUsd, raw, escalated: false };
}
```

핵심 포인트:
- **content 순서는 `[이미지, 텍스트]`** — 공식 권장. 이미지를 먼저 둔다.
- 응답 파싱은 **`tool_use.input`을 직접** 사용한다(이미 스키마 검증됨). `tool_use`가 없는 예외 상황만 텍스트 펜스 파싱으로 폴백하고, 그마저 실패하면 `raw`를 보관해 Phase 4에서 "보정 없음 + 경고"로 처리한다(잘못된 보정 > 무보정).
- 멀티이미지 제약: 한 요청에 이미지를 20개 넘기면 per-image 치수 제한이 더 엄격해진다. 시스템 단위 호출은 이미지 1개라 안전하지만, 배치로 묶을 때는 각 이미지를 양 변 2000px 이하로 유지한다.

#### 티어링 오케스트레이션과 비용 가드

```ts
// 잡 전체에서 시스템들을 순회
export async function verifyAllSystems(
  systems: SystemInput[],
  budget: { jobCostLimitUsd: number; wrongNotesEscalateThreshold: number },
): Promise<{ results: VerifyResult[]; totalCostUsd: number; stoppedEarly: boolean }> {
  let totalCostUsd = 0;
  const results: VerifyResult[] = [];

  for (const sys of systems) {
    if (totalCostUsd >= budget.jobCostLimitUsd) {
      return { results, totalCostUsd, stoppedEarly: true }; // 부분 결과 반환
    }

    // 1차: sonnet
    let r = await verifySystem(sys.imagePath, sys.measuresJson, {
      measureNumbers: sys.measureNumbers,
      model: "claude-sonnet-4-6",
    });
    totalCostUsd += r.costUsd;

    // 승격 조건: confidence=low 또는 wrong_notes 임계 초과
    const wrong = r.correction.wrong_notes?.length ?? 0;
    if (
      (r.correction.confidence === "low" ||
        wrong >= budget.wrongNotesEscalateThreshold) &&
      totalCostUsd < budget.jobCostLimitUsd
    ) {
      const r2 = await verifySystem(sys.imagePath, sys.measuresJson, {
        measureNumbers: sys.measureNumbers,
        model: "claude-opus-4-8",
      });
      totalCostUsd += r2.costUsd;
      r = { ...r2, escalated: true };
      console.log(`[escalate] system=${sys.id} → opus (confidence/wrong_notes)`);
    }

    results.push(r);
  }
  return { results, totalCostUsd, stoppedEarly: false };
}
```

비용 추정은 공식 식에 근거한다. **visual tokens = `⌈width/28⌉ × ⌈height/28⌉`**(다운스케일 후 치수 기준; 과거 `width×height/750` 휴리스틱은 폐기됨). 사전 측정이 필요하면 `count_tokens` API에 이미지 포함 메시지를 그대로 넘겨 visual token을 잰다. 비용 가드는 (텍스트 input + Σ visual tokens) × 모델 input 단가로 잡고, `cost_usd`를 jobs 레코드에 누적 기록한다. `JOB_COST_LIMIT_USD`(기본 $2.00) 초과 시 즉시 중단하고 **여태 모은 부분 결과**를 반환한다.

```text
[프롬프트 — Phase 3]
역할: 너는 OMR(광학 악보 인식) 검증기를 만든다. UI는 없고 백엔드 워커 모듈만 만든다.

목표:
Phase 2에서 만든 "시스템(보표 줄) 단위 크롭 PNG"와 "그 시스템의 마디 데이터(coords.json/musicxml 요약)"를
Claude에 보내, Audiveris 추출 데이터의 오류만 구조화 JSON으로 회수하는 모듈을 만든다.
보정 JSON은 다음 단계(Phase 4)에서 MusicXML에 실제 반영되므로, 환각(멀쩡한 부분을 틀렸다고 보고)을
억제하는 것이 정확도보다 우선이다.

절대 규칙:
- 입력 단위는 "페이지 전체"가 아니라 "시스템 단위 크롭 이미지"다. (작은 음표 대조 정확도를 위해)
- Claude API 키(ANTHROPIC_API_KEY)는 서버 환경변수에서만 읽는다. 프론트 번들에 절대 노출 금지.
- 모델 ID는 정확히: 1차=claude-sonnet-4-6, 승격=claude-opus-4-8. (추측 모델명 금지)
- 구조화 출력은 tool use로 강제한다. 도구 정의에 strict:true(최상위 필드, tool_choice가 아님),
  input_schema에 additionalProperties:false + required. 응답은 tool_use.input을 직접 사용하고,
  tool_use가 없을 때만 text의 ```json 펜스를 제거해 파싱하는 폴백을 둔다(파싱 실패 시 raw 보관).
- 메시지 content는 [이미지 블록, 텍스트 프롬프트] 순서(이미지 먼저).
- prompt caching: 시스템 프롬프트/도구 스키마/공통 지시 등 안정 접두부에 cache_control:{type:"ephemeral"}.
  시스템마다 바뀌는 이미지·마디 목록은 캐시 브레이크포인트 뒤에 둔다.
  최소 캐시 길이는 모델별로 다름(sonnet-4-6=2048토큰, opus-4-8=4096토큰)에 유의.

도구(JSON 스키마) 형태:
report_corrections(
  missing_chords:[{measure,beat?,chord}],
  missing_lyrics:[{measure,syllable_index?,text}],
  wrong_notes:[{measure,voice?,staff?,expected_pitch,got_pitch}],
  extra_or_missing_notes:[{measure,kind:"extra"|"missing",pitch?}],
  confidence:"high"|"medium"|"low",
  notes?:string
)
- measure는 그 시스템의 "실제(절대) 마디 번호"로 답하게 한다. 프롬프트에 그 시스템이 포함한
  마디 번호 목록을 명시적으로 라벨링해 넣는다.

프롬프트 작성 지침(환각 억제 — 강하게):
- "원본 이미지가 진실(ground truth). Audiveris 데이터의 오류만 보고하라. 일치하면 아무것도 보고하지 마라."
- "확실하지 않으면 보고하지 말고 confidence를 낮춰라. 추측·발명 금지."
- "한 마디의 음표 개수를 세려 하지 마라(비전의 약점). 명백한 누락 코드/가사, 명백히 다른 음높이만 보고하라."
- "설명하지 말고 오직 도구 호출로만 답하라."

함수 시그니처:
- verifySystem(systemImagePath:string, measuresJsonForSystem:object,
    opts:{measureNumbers:number[]; model?:"claude-sonnet-4-6"|"claude-opus-4-8"; maxRetries?:number})
    : Promise<{correction, model, costUsd, raw, escalated}>
- verifyAllSystems(systems, budget:{jobCostLimitUsd, wrongNotesEscalateThreshold})
    : 시스템 순회 → 1차 sonnet → confidence=low 또는 wrong_notes 임계 초과 시 opus 승격 → 비용 누적.

티어링·비용 가드:
- 1차 claude-sonnet-4-6 전 시스템. confidence=low이거나 wrong_notes 임계 초과 시스템만 claude-opus-4-8 재검증.
- 시스템당/잡당 호출 상한, 재시도 N회(기본 2), cost_usd 누적 기록.
- 비용 추정은 공식 식 사용: visual tokens = ceil(width/28) * ceil(height/28) (다운스케일 후 치수).
  필요 시 count_tokens API로 사전 측정.
- JOB_COST_LIMIT_USD(기본 2.00) 초과 시 중단하고 "부분 결과 + 경고"를 반환(잘못된 보정 > 무보정).

(선택) Message Batches:
- 다수 시스템을 비실시간으로 묶어 처리할 때 Message Batches API를 옵션으로 지원.
  모든 토큰 50% 할인, 비전/tool use/caching 전부 지원. 결과 순서 무보장이므로 custom_id에 시스템 인덱스 인코딩.

산출물:
- /worker/src/vision.ts  (verifySystem, verifyAllSystems, estimateCostUsd, 도구 정의)
- /worker/src/prompts/verify-system.ts  (VERIFY_SYSTEM_PROMPT, buildUserPrompt)
- /worker/src/vision.test.ts  (SDK 응답을 목 주입 → tool_use.input 파싱 / 텍스트 펜스 폴백 / 티어링 / 비용 집계 검증)
- npm run verify  스크립트로 단일 시스템 크롭에 대해 모듈을 한 번 돌려볼 수 있게.

테스트(모킹) 요건:
- @anthropic-ai/sdk 클라이언트를 목으로 대체하고, tool_use 블록을 담은 가짜 응답을 주입해
  파싱 결과가 스키마와 일치하는지 검증.
- confidence:"low" 응답을 주입하면 opus 승격이 호출되는지(escalated=true) 검증.
- 비용 누적이 JOB_COST_LIMIT_USD를 넘으면 stoppedEarly=true로 부분 결과를 반환하는지 검증.
```

**산출물**
- `/worker/src/vision.ts` — `verifySystem(systemImagePath, measuresJsonForSystem, opts)`, `verifyAllSystems(...)`, `estimateCostUsd(model, usage)`, 도구 정의 `VERIFY_TOOL`(strict).
- `/worker/src/prompts/verify-system.ts` — `VERIFY_SYSTEM_PROMPT`(캐시되는 안정 접두부, 환각 억제 규칙), `buildUserPrompt(measuresJson, measureNumbers)`.
- `/worker/src/vision.test.ts` — SDK 목 주입 테스트(파싱·폴백·티어링·비용 집계).
- `npm run verify` — 단일 시스템 크롭으로 모듈 1회 실행하는 스크립트.

**완료 판정**(체크 가능)
- [ ] 시스템 크롭 PNG 1개를 넣으면, 위 스키마에 정확히 일치하는 보정 JSON이 `tool_use.input`에서 그대로 나온다(텍스트 파싱 폴백 경로를 타지 않는다).
- [ ] `confidence: "low"` 또는 `wrong_notes` 임계 초과 시스템에서 `claude-opus-4-8` 재검증이 호출되고 로그에 `[escalate] ... → opus`가 남는다(`escalated: true`).
- [ ] `usage.cache_read_input_tokens`가 두 번째 시스템 호출부터 0이 아니다(시스템 프롬프트/스키마 캐시 적중).
- [ ] `cost_usd`가 호출마다 누적되어 jobs 레코드에 기록되고, `JOB_COST_LIMIT_USD` 초과 시 `stoppedEarly: true`로 부분 결과를 반환한다.
- [ ] 모킹 테스트 전부 통과: tool_use 파싱 / 텍스트 펜스 폴백 / 티어링 승격 / 비용 가드 중단.
- [ ] 이미지와 일치하는(오류 없는) 시스템을 넣으면 모든 배열이 빈 배열이고 `confidence: "high"`로 나온다(환각 미발생 확인).

**정확도 영향**
- 페이지 → 시스템 단위 크롭으로 바꾸는 것만으로 작은 음표/임시표/가사 대조 정확도가 크게 오른다. `claude-sonnet-4-6`은 1568px로 다운스케일되므로, 풀페이지를 보내면 밀집 악보가 뭉개진다 — 크롭이 이 손실을 막는 1차 레버다.
- tool use strict 스키마 강제가 "JSON-only 지시"보다 견고해, Phase 4가 받는 입력이 항상 파싱 가능한 형태로 보장된다(파이프라인 신뢰성 = 정확도).
- 환각 억제 프롬프트(불확실=침묵, 카운팅 금지)가 false positive를 줄여, Phase 4의 AUTO_PATCH가 정상 음표를 망가뜨리는 사고를 차단한다.
- 티어링은 정확도와 비용의 절충점을 자동 조정한다 — 저신뢰 시스템만 high-res Opus(2576px)로 재검증해, 비용을 통제하면서 어려운 줄의 정확도를 끌어올린다.

**검증 명령**
```bash
# 1) 단일 시스템 크롭에 대해 모듈 실행 (보정 JSON이 스키마대로 나오는지 눈으로 확인)
ANTHROPIC_API_KEY=sk-... npm run verify -- ./work/<jobId>/systems/sys-03.png ./work/<jobId>/parsed/sys-03.json

# 2) 모킹 단위테스트 (실제 API 호출 없이 파싱/티어링/비용 가드 검증)
npm test -- vision.test.ts

# 3) 비용 사전 측정: 크롭 이미지의 visual token 수 확인 (count_tokens)
#    payload.json = {model, messages:[{role:"user", content:[{type:"image",...},{type:"text",...}]}]}
curl -s https://api.anthropic.com/v1/messages/count_tokens \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d @payload.json | jq '.input_tokens'

# 4) 캐시 적중 확인: 같은 잡의 2번째 시스템부터 cache_read_input_tokens > 0 인지 로그 확인
grep -E "cache_read_input_tokens" ./work/<jobId>/vision.log
```

# Módulo Casos

Contexto delimitado responsável pela criação, ciclo de vida, observações e rastreabilidade de casos.

## Estrutura

- `domain`
  - `entities/Case.ts`: padronização de código do caso, rascunho de criação a partir do exame e entradas de linha do tempo.
  - `valueObjects/CaseStatus.ts`: objeto de valor do ciclo de vida ortodôntico.
  - `services/CaseLifecycleService.ts`: regras de status, fase, SLA, rework e milestones do caso.
  - `services/CaseTimelineService.ts`: consolidação do histórico auditável do caso.
- `application`
  - `ports/CaseRepository.ts`: contrato para local/Firebase.
  - `useCases/*`: `CreateCaseFromScan`, `UpdateCaseStatus`, `AddCaseNote`, `ListCaseTimeline`.
- `infra`
  - `local/LocalCaseRepository.ts`: persistência local com auditoria e atualização do domínio do caso.
  - `firebase/FirestoreCaseRepository.ts`: persistência remota com linha do tempo persistida em `data.timelineEntries`.
- `presentation`
  - `hooks/*`: ponte da UI para os casos de uso.
  - `sections/*`: seções extraídas da `CaseDetailPage`.

## Domínio Ortodôntico

- O ciclo de vida cobre `scan_received`, `scan_approved`, `case_created`, `in_production`, `qc`, `shipped`, `delivered`, `in_use` e `rework`.
- O agregado do caso expõe `lifecycleStatus`, `domainEvents`, `sla` e `reworkSummary`.
- A linha do tempo unifica eventos funcionais, auditoria e alertas de SLA em ordem cronológica reversa.
- Eventos de domínio emitidos pelo contexto: `CaseApproved`, `CaseCreated`, `LabStarted`, `LabShipped` e `CaseDelivered`.

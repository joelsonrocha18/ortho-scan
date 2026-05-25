# Módulo Laboratório

Contexto delimitado responsável pelo pipeline laboratorial, fila de produção, SLA e reconfecções.

## Estrutura

- `domain`
  - `entities/LabOrder.ts`: agregado da OS LAB com etapa, linha do tempo de etapas e eventos.
  - `valueObjects/LabStage.ts`: objeto de valor das etapas `queued`, `in_production`, `qc`, `shipped`, `delivered` e `rework`.
  - `services/ProductionQueueService.ts`: ordenação da fila, prioridade e alertas.
  - `services/LabSLAService.ts`: política de SLA por etapa e status `on_track`, `warning`, `overdue`.
  - `services/ReworkFinancialImpactService.ts`: estimativa de impacto financeiro de reconfecção.
- `application`
  - `ports/LabRepository.ts`: contrato para adaptadores locais e remotos.
  - `useCases/*`: `RegisterLabOrder`, `UpdateLabStage`, `RegisterShipment`, `RegisterRework`.
- `infra`
  - `local/LocalLabRepository.ts`: persistência local com atualização de ciclo de vida do caso e auditoria.
  - `firebase/*`: mapeadores e adaptadores remotos.
- `presentation`
  - `LabPageContainer`, hooks, seções e modais extraídos do monolito original.

## Domínio Laboratorial

- O pipeline laboratorial expõe prioridade operacional e ordenação por SLA.
- Cada OS passa a carregar `stage`, `stageTimeline`, `domainEvents`, `sla` e, quando aplicável, `financialImpact`.
- Reconfecções agora registram vínculo com o caso original e retornam impacto financeiro estimado em BRL.

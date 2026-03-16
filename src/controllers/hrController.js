const { getSfConnection } = require("../config/salesforce");

// --- HELPER: GARANTIR QUE EXISTE O BANCO DE HORAS PAI ---
async function getOrCreateBancoHoras(conn, pessoaId) {
  const query = `SELECT Id FROM BancoHoras__c WHERE Pessoa__c = '${pessoaId}' LIMIT 1`;
  const result = await conn.query(query);
  if (result.totalSize > 0) return result.records[0].Id;
  const novoBanco = await conn
    .sobject("BancoHoras__c")
    .create({ Pessoa__c: pessoaId });
  if (novoBanco.success) return novoBanco.id;
  throw new Error("Falha ao criar Banco de Horas.");
}

// --- PAINEL UNIFICADO: GESTÃO DE PONTO & CICLO ---
exports.getHrEmployees = async (req, res) => {
  try {
    const conn = await getSfConnection();
    const { inicio, fim, statusPeriodo } = req.query;

    let wherePeriodo = `WHERE DataInicio__c = ${inicio} AND DataFim__c = ${fim}`;
    if (statusPeriodo) {
      if (statusPeriodo === "Anexo de Notas") {
        wherePeriodo += ` AND Status__c = 'Liberado para Nota Fiscal' AND Id NOT IN (SELECT Periodo__c FROM NotaFiscal__c WHERE Tipo__c = 'Entrada')`;
      } else {
        wherePeriodo += ` AND Status__c = '${statusPeriodo}'`;
      }
    }

    const soqlPeriodos = `
            SELECT Id, Name, Status__c, ContratoPessoa__r.Pessoa__c, ContratoPessoa__r.Pessoa__r.Name, 
                   ContratoPessoa__r.Pessoa__r.URL_Foto__c, ContratoPessoa__r.PJ__c,
                   ContratoPessoa__r.Cargo__c, QuantidadeDiasUteis__c, ContratoPessoa__r.Hora__c,
                   ValorTotalHoras__c, ValorTotalBeneficios__c, ValorTotalPeriodo__c, ValorHora__c, TotalHoras__c,
                   (SELECT Id FROM DiasPeriodo__r WHERE Tipo__c = 'Útil' AND DiaCompleto__c = false),
                   (SELECT Id FROM NotasFiscais__r WHERE Tipo__c = 'Entrada' LIMIT 1)
            FROM Periodo__c
            ${wherePeriodo}
        `;

    const filtroHoras = `(Horas__c > 0 OR HorasExtras__c > 0 OR (HorasBanco__c != 0 AND HorasBanco__c != null) OR HorasAusenciaRemunerada__c > 0 OR HorasAusenciaNaoRemunerada__c > 0)`;

    const soqlAgregado = `
            SELECT DiaPeriodo__r.Periodo__c, Status__c,
                   SUM(Horas__c) normal, SUM(HorasExtras__c) extra, SUM(HorasBanco__c) banco,
                   SUM(HorasAusenciaRemunerada__c) ausRem, SUM(HorasAusenciaNaoRemunerada__c) ausNaoRem
            FROM LancamentoHora__c 
            WHERE DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim}
            AND ${filtroHoras}
            GROUP BY DiaPeriodo__r.Periodo__c, Status__c
        `;

    const [resPeriodos, resAgregado] = await Promise.all([
      conn.query(soqlPeriodos),
      conn.query(soqlAgregado)
    ]);

    const periodDataMap = {};
    resPeriodos.records.forEach((p) => {
      periodDataMap[p.Id] = {
        pendingRH: 0,
        pendingService: 0,
        totalRealizado: 0,
        hasNota: p.NotasFiscais__r && (p.NotasFiscais__r.totalSize > 0 || (p.NotasFiscais__r.records && p.NotasFiscais__r.records.length > 0))
      };
    });

    resAgregado.records.forEach((r) => {
      const data = periodDataMap[r.Periodo__c];
      if (!data) return;
      if (r.Status__c === "Em aprovação do RH") data.pendingRH += 1;
      if (
        r.Status__c === "Em aprovação do serviço" ||
        r.Status__c === "Rascunho"
      )
        data.pendingService += 1;
      data.totalRealizado +=
        (r.normal || 0) +
        (r.extra || 0) +
        Math.abs(r.banco || 0) +
        (r.ausRem || 0) +
        (r.ausNaoRem || 0);
    });

    const tableData = resPeriodos.records.map((per) => {
      const data = periodDataMap[per.Id];
      const contractHours =
        (per.QuantidadeDiasUteis__c || 0) *
        (per.ContratoPessoa__r?.Hora__c || 8);
      const incompleteDays = per.DiasPeriodo__r
        ? per.DiasPeriodo__r.totalSize
        : 0;

      return {
        id: per.ContratoPessoa__r?.Pessoa__c,
        periodId: per.Id,
        name: per.ContratoPessoa__r?.Pessoa__r?.Name || "Desconhecido",
        photo: per.ContratoPessoa__r?.Pessoa__r?.URL_Foto__c || null,
        role: per.ContratoPessoa__r?.Cargo__c || "Consultor",
        isPJ: per.ContratoPessoa__r?.PJ__c !== false, // Assume true se nulo, ou usa o valor do checkbox
        total: data ? data.totalRealizado : 0,
        contract: contractHours,
        statusPeriodo: per.Status__c,
        hasNota: data ? data.hasNota : false,
        incompleteDays: incompleteDays,
        hasLogsPendingRH: data ? data.pendingRH > 0 : false,
        valorHora: per.ValorHora__c || 0,
        totalHorasFinanceiro: per.TotalHoras__c || 0,
        valorTotalHoras: per.ValorTotalHoras__c || 0,
        valorTotalBeneficios: per.ValorTotalBeneficios__c || 0,
        valorTotalPeriodo: per.ValorTotalPeriodo__c || 0
      };
    });

    // Funil Global (sempre calculado sobre o período total)
    const funnelQuery = `SELECT Status__c, COUNT(Id) total FROM Periodo__c WHERE DataInicio__c = ${inicio} AND DataFim__c = ${fim} GROUP BY Status__c`;
    
    // Contagem específica para Anexo de Notas (Pendente de nota)
    const anexoQuery = `SELECT COUNT(Id) total FROM Periodo__c WHERE DataInicio__c = ${inicio} AND DataFim__c = ${fim} AND Status__c = 'Liberado para Nota Fiscal' AND Id NOT IN (SELECT Periodo__c FROM NotaFiscal__c WHERE Tipo__c = 'Entrada')`;

    const [resFunnel, resAnexo] = await Promise.all([
      conn.query(funnelQuery),
      conn.query(anexoQuery)
    ]);

    const funnelData = resFunnel.records.map(r => ({ Status__c: r.Status__c, total: r.total || r.expr0 || 0 }));
    funnelData.push({ Status__c: 'Anexo de Notas', total: resAnexo.records[0].total || resAnexo.records[0].expr0 || 0 });

    res.json({ funnel: funnelData, data: tableData });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getEmployeeDetails = async (req, res) => {
  try {
    const conn = await getSfConnection();
    const { personId } = req.params;
    const { inicio, fim } = req.query;
    const filtroHoras = `(Horas__c > 0 OR HorasExtras__c > 0 OR (HorasBanco__c != 0 AND HorasBanco__c != null) OR HorasAusenciaRemunerada__c > 0 OR HorasAusenciaNaoRemunerada__c > 0)`;
    const result = await conn.query(`
            SELECT Id, DiaPeriodo__r.Data__c, Servico__r.Name, Atividade__r.Name, Justificativa__c, Status__c, MotivoReprovacao__c,
                   Horas__c, HorasExtras__c, HorasBanco__c, HorasAusenciaRemunerada__c, HorasAusenciaNaoRemunerada__c
            FROM LancamentoHora__c 
            WHERE Pessoa__c = '${personId}' AND DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim} AND ${filtroHoras}
            ORDER BY DiaPeriodo__r.Data__c ASC
        `);

    let sumNormal = 0,
      sumExtra = 0,
      sumBanco = 0,
      sumAusencia = 0;
    const logs = result.records.map((r) => {
      const hN = r.Horas__c || 0;
      const hE = r.HorasExtras__c || 0;
      const hB = r.HorasBanco__c || 0;
      const hA =
        (r.HorasAusenciaRemunerada__c || 0) +
        (r.HorasAusenciaNaoRemunerada__c || 0);
      sumNormal += hN;
      sumExtra += hE;
      sumBanco += hB;
      sumAusencia += hA;
      return {
        id: r.Id,
        date: r.DiaPeriodo__r?.Data__c,
        project: r.Servico__r?.Name,
        activity: r.Atividade__r?.Name,
        justification: r.Justificativa__c,
        reason: r.MotivoReprovacao__c,
        status: r.Status__c,
        normal: hN,
        extraPgto: hE,
        banco: hB,
        ausencia: hA
      };
    });

    const resMeta = await conn.query(
      `SELECT QuantidadeDiasUteis__c, ContratoPessoa__r.Hora__c FROM Periodo__c WHERE ContratoPessoa__r.Pessoa__c = '${personId}' AND DataInicio__c >= ${inicio} AND DataFim__c <= ${fim} LIMIT 1`
    );
    let contractHours = 0;
    if (resMeta.totalSize > 0)
      contractHours =
        (resMeta.records[0].QuantidadeDiasUteis__c || 0) *
        (resMeta.records[0].ContratoPessoa__r?.Hora__c || 8);

    res.json({
      logs,
      summary: {
        normal: sumNormal,
        extra: sumExtra,
        banco: sumBanco,
        ausencia: sumAusencia,
        totalRealizado: sumNormal + sumExtra + Math.abs(sumBanco) + sumAusencia,
        contract: contractHours
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.handleHrAction = async (req, res) => {
  const { personId, action, inicio, fim, motivo, entryIds } = req.body;
  const novoStatus = action === "approve" ? "Aprovado" : "Reprovado RH";

  try {
    const conn = await getSfConnection();
    let updates = [];
    let affectedPeriodIds = new Set();

    if (entryIds && Array.isArray(entryIds) && entryIds.length > 0) {
      // AÇÃO EM LOGS ESPECÍFICOS - Valida se ainda estão pendentes de RH
      const idsList = entryIds.map((id) => `'${id}'`).join(",");
      const logsCheck = await conn.query(
        `SELECT Id, Periodo__c, DiaPeriodo__r.Periodo__c FROM LancamentoHora__c WHERE Id IN (${idsList}) AND Status__c = 'Em aprovação do RH'`
      );

      updates = logsCheck.records.map((r) => ({
        Id: r.Id,
        Status__c: novoStatus,
        MotivoReprovacao__c: action === "reject" ? motivo : null
      }));

      logsCheck.records.forEach((r) => {
        const pId = r.Periodo__c || r.DiaPeriodo__r?.Periodo__c;
        if (pId) affectedPeriodIds.add(pId);
      });
    } else {
      // AÇÃO NO COLABORADOR INTEIRO
      const query = `SELECT Id, Periodo__c, DiaPeriodo__r.Periodo__c FROM LancamentoHora__c WHERE Pessoa__c = '${personId}' AND DiaPeriodo__r.Data__c >= ${inicio} AND DiaPeriodo__r.Data__c <= ${fim} AND Status__c = 'Em aprovação do RH'`;
      const result = await conn.query(query);
      updates = result.records.map((r) => ({
        Id: r.Id,
        Status__c: novoStatus,
        MotivoReprovacao__c: action === "reject" ? motivo : null
      }));
      result.records.forEach((r) => {
        const pId = r.Periodo__c || r.DiaPeriodo__r?.Periodo__c;
        if (pId) affectedPeriodIds.add(pId);
      });
    }

    if (updates.length > 0) {
      await conn.sobject("LancamentoHora__c").update(updates);

      // --- LOGICA DE TRANSIÇÃO DO STATUS DO PERÍODO ---
      if (affectedPeriodIds.size > 0) {
        if (action === "reject") {
          // REPROVAÇÃO: Sempre volta o período para 'Aberto'
          const periodUpdates = Array.from(affectedPeriodIds).map((id) => ({
            Id: id,
            Status__c: "Aberto"
          }));
          await conn.sobject("Periodo__c").update(periodUpdates);
        } else {
          // APROVAÇÃO: Verifica se o período PODE avançar para 'Liberado para Nota Fiscal'
          for (const pId of affectedPeriodIds) {
            const pendingQuery = `
                            SELECT COUNT(Id) total 
                            FROM LancamentoHora__c 
                            WHERE Periodo__c = '${pId}' 
                            AND Status__c != 'Aprovado'
                        `;
            const pendingRes = await conn.query(pendingQuery);
            const totalPending = parseInt(
              pendingRes.records[0].total || pendingRes.records[0].expr0 || 0
            );

            // Se TUDO do período está aprovado (independente de serviço), ele avança
            if (totalPending === 0) {
              const periodData = await conn.query(
                `SELECT ContratoPessoa__r.PJ__c FROM Periodo__c WHERE Id = '${pId}' LIMIT 1`
              );
              const isPJ =
                periodData.records[0]?.ContratoPessoa__r?.PJ__c !== false;
              const nextStatus = isPJ
                ? "Liberado para Nota Fiscal"
                : "Pronto para Pagamento";

              await conn
                .sobject("Periodo__c")
                .update({ Id: pId, Status__c: nextStatus });
            }
          }
        }
      }
    } else if (action === "reject" && personId !== "MASS") {
      // FALLBACK: Se não encontrou logs pendentes mas o RH clicou em reprovar na linha,
      // força a reabertura do período atual daquela pessoa.
      const periodRes = await conn.query(
        `SELECT Id FROM Periodo__c WHERE ContratoPessoa__r.Pessoa__c = '${personId}' AND DataInicio__c = ${inicio} AND DataFim__c = ${fim} LIMIT 1`
      );
      if (periodRes.totalSize > 0) {
        await conn
          .sobject("Periodo__c")
          .update({ Id: periodRes.records[0].Id, Status__c: "Aberto" });
      }
    }
    res.json({
      success: true,
      message:
        updates.length > 0
          ? `${updates.length} lançamentos processados.`
          : "Período reaberto para correção."
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};

exports.renderHrDashboard = (req, res) => {
  res.render("hr_dashboard", { user: req.session.user, page: "hr" });
};

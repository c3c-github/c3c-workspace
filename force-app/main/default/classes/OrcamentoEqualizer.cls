public with sharing class OrcamentoEqualizer {
    
    /**
     * Equaliza os orçamentos de todos os serviços ativos
     */
    public static void equalizeAllActive() {
        List<Alocacao__c> alocs = [
            SELECT Id, Servico__c, DataInicio__c, DataFimOriginal__c, Percentual__c, TaxaVenda__c, CustoHr__c 
            FROM Alocacao__c 
            WHERE Servico__r.Status__c = 'Ativo'
        ];
        processAllocations(alocs);
    }

    /**
     * Equaliza os orçamentos de um serviço específico
     */
    public static void equalizeService(Id serviceId) {
        List<Alocacao__c> alocs = [
            SELECT Id, Servico__c, DataInicio__c, DataFimOriginal__c, Percentual__c, TaxaVenda__c, CustoHr__c 
            FROM Alocacao__c 
            WHERE Servico__c = :serviceId
        ];
        processAllocations(alocs);
    }

    private static void processAllocations(List<Alocacao__c> alocs) {
        if (alocs.isEmpty()) return;

        Set<Id> alocIds = new Map<Id, Alocacao__c>(alocs).keySet();
        
        // 1. Limpar orçamentos existentes (com tratamento para evitar erros de concorrência)
        List<OrcamentoCompetencia__c> existingOrcs = [SELECT Id FROM OrcamentoCompetencia__c WHERE Alocacao__c IN :alocIds];
        if (!existingOrcs.isEmpty()) {
            Database.delete(existingOrcs, false); // false = ignore errors (all or nothing = false)
        }

        // 2. Pré-carregar feriados para o período total das alocações
        Date minDate;
        Date maxDate;
        for (Alocacao__c a : alocs) {
            if (a.DataInicio__c != null && (minDate == null || a.DataInicio__c < minDate)) minDate = a.DataInicio__c;
            if (a.DataFimOriginal__c != null && (maxDate == null || a.DataFimOriginal__c > maxDate)) maxDate = a.DataFimOriginal__c;
        }

        Set<Date> holidayDates = new Set<Date>();
        if (minDate != null && maxDate != null) {
            for (Holiday h : [SELECT ActivityDate FROM Holiday WHERE ActivityDate >= :minDate AND ActivityDate <= :maxDate]) {
                holidayDates.add(h.ActivityDate);
            }
        }

        List<OrcamentoCompetencia__c> toInsert = new List<OrcamentoCompetencia__c>();
        
        for (Alocacao__c aloc : alocs) {
            if (aloc.DataInicio__c == null || aloc.DataFimOriginal__c == null) continue;

            Date start = aloc.DataInicio__c;
            Date endD = aloc.DataFimOriginal__c;
            
            Date cur = start.toStartOfMonth();
            Date endLimit = endD.toStartOfMonth();

            while (cur <= endLimit) {
                Date mStart = cur;
                Date mEnd = cur.addMonths(1).toStartOfMonth().addDays(-1);

                Date overlapStart = start > mStart ? start : mStart;
                Date overlapEnd = endD < mEnd ? endD : mEnd;

                Integer days = countBusinessDays(overlapStart, overlapEnd, holidayDates);
                
                if (days > 0) {
                    Decimal hours = days * 8 * ((aloc.Percentual__c != null ? aloc.Percentual__c : 0) / 100);
                    toInsert.add(new OrcamentoCompetencia__c(
                        Alocacao__c = aloc.Id,
                        Servico__c = aloc.Servico__c,
                        Competencia__c = mStart,
                        ReceitaPrevista__c = hours * (aloc.TaxaVenda__c != null ? aloc.TaxaVenda__c : 0),
                        CustoPrevisto__c = hours * (aloc.CustoHr__c != null ? aloc.CustoHr__c : 0)
                    ));
                }
                cur = cur.addMonths(1);
            }
        }

        if (!toInsert.isEmpty()) {
            insert toInsert;
        }
    }

    private static Integer countBusinessDays(Date start, Date endD, Set<Date> holidayDates) {
        if (start > endD) return 0;
        
        Integer days = 0;
        Date cur = start;
        while (cur <= endD) {
            Datetime dt = Datetime.newInstance(cur.year(), cur.month(), cur.day());
            String dayOfWeek = dt.format('E');
            if (dayOfWeek != 'Sat' && dayOfWeek != 'Sun' && !holidayDates.contains(cur)) {
                days++;
            }
            cur = cur.addDays(1);
        }
        return days;
    }
}
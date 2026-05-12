/**
 * Validador e Limpador de Customizações de Pedido
 * 
 * Funções:
 * 1. Identifica duplicatas usando identity key canônico
 * 2. Remove URLs temporárias expiradas
 * 3. Mantém apenas versão mais recente por identidade
 * 4. Valida integridade de dados em OrderItemCustomization
 * 
 * Uso:
 *   npm run validate:customizations [--dry-run] [--verbose]
 */

import prisma from '../database/prisma';
import logger from '../utils/logger';

interface DuplicateGroup {
  identity: string;
  records: any[];
  keepId: string;
  removeIds: string[];
}

interface ValidationIssue {
  recordId: string;
  orderItemId: string;
  issue: string;
  severity: 'error' | 'warning';
  suggested_fix?: string;
}

interface CleanupReport {
  total_records: number;
  duplicates_found: number;
  expired_urls: number;
  records_removed: number;
  validation_issues: ValidationIssue[];
  cleanup_actions: string[];
}

class OrderCustomizationValidator {
  private dryRun: boolean;
  private verbose: boolean;
  private report: CleanupReport = {
    total_records: 0,
    duplicates_found: 0,
    expired_urls: 0,
    records_removed: 0,
    validation_issues: [],
    cleanup_actions: [],
  };

  constructor(dryRun: boolean = false, verbose: boolean = false) {
    this.dryRun = dryRun;
    this.verbose = verbose;
  }

  private log(msg: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info') {
    if (level === 'debug' && !this.verbose) return;
    logger[level](msg);
  }

  private getIdentityKey(
    customizationType: string,
    ruleId: string | null | undefined,
    componentId: string | null | undefined
  ): string {
    const normalizedType = (customizationType || 'UNKNOWN').toUpperCase();
    const normalizedRuleId = this.normalizeRuleId(ruleId)?.replace(/:component.*$/, '') || 'default';
    const finalComponentId = componentId || 'default';
    return `${normalizedType}:${normalizedRuleId}:${finalComponentId}`;
  }

  private normalizeRuleId(id: string | null | undefined): string | null {
    if (!id) return null;
    return String(id).trim().toLowerCase();
  }

  private parseCustomizationValue(value: string): any {
    try {
      return JSON.parse(value);
    } catch {
      return { raw: value };
    }
  }

  private async isUrlExpired(url: string): Promise<boolean> {
    if (!url) return false;

    if (url.startsWith('blob:') || url.startsWith('data:')) {
      return false;
    }

    if (url.includes('/uploads/temp/')) {
      const filename = url.split('/uploads/temp/').pop();
      if (!filename) return true;

      const tempUpload = await prisma.tempUpload.findFirst({
        where: { filename, deletedAt: null },
        orderBy: { uploadedAt: 'desc' },
      });

      if (!tempUpload) return true;
      return tempUpload.expiresAt < new Date();
    }

    return false;
  }

  private collectUrlsFromRecord(parsedValue: any): string[] {
    const urls: string[] = [];

    const walk = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;

      if (Array.isArray(obj)) {
        obj.forEach(walk);
        return;
      }

      if (typeof obj.url === 'string' && obj.url) urls.push(obj.url);
      if (typeof obj.preview_url === 'string' && obj.preview_url) urls.push(obj.preview_url);
      if (typeof obj.google_drive_url === 'string' && obj.google_drive_url) urls.push(obj.google_drive_url);

      Object.values(obj).forEach((v: any) => walk(v));
    };

    walk(parsedValue);
    return [...new Set(urls)];
  }

  async findDuplicates(): Promise<DuplicateGroup[]> {
    this.log('🔍 Procurando por duplicatas...', 'info');

    const records = await prisma.orderItemCustomization.findMany({
      include: { orderItem: true },
    });

    this.report.total_records = records.length;

    const grouped = new Map<string, any[]>();

    for (const record of records) {
      const parsed = this.parseCustomizationValue(record.value);
      const type = parsed.type || 'UNKNOWN';
      const ruleId = parsed.rule_id || parsed.customization_id || record.customization_id;
      const componentId = parsed.component_id || null;

      const key = `${record.order_item_id}:${this.getIdentityKey(type, ruleId, componentId)}`;

      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(record);
    }

    const duplicates: DuplicateGroup[] = [];

    for (const [identity, records] of grouped) {
      if (records.length > 1) {
        const sorted = records.sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());

        duplicates.push({
          identity,
          records,
          keepId: sorted[0].id,
          removeIds: sorted.slice(1).map((r) => r.id),
        });

        this.report.duplicates_found++;
      }
    }

    this.log(`✅ Encontradas ${duplicates.length} identidades duplicadas`, 'info');
    return duplicates;
  }

  async findExpiredUrls(): Promise<{ recordId: string; expiredUrls: string[] }[]> {
    this.log('🔍 Procurando URLs expiradas...', 'info');

    const records = await prisma.orderItemCustomization.findMany();
    const expiredRecords: { recordId: string; expiredUrls: string[] }[] = [];

    for (const record of records) {
      const parsed = this.parseCustomizationValue(record.value);
      const urls = this.collectUrlsFromRecord(parsed);

      const expiredUrls = [];
      for (const url of urls) {
        if (await this.isUrlExpired(url)) {
          expiredUrls.push(url);
        }
      }

      if (expiredUrls.length > 0) {
        this.report.expired_urls += expiredUrls.length;
        expiredRecords.push({
          recordId: record.id,
          expiredUrls,
        });

        this.log(
          `⚠️  ${record.id}: ${expiredUrls.length} URLs expiradas encontradas`,
          'warn'
        );
      }
    }

    this.log(`✅ ${expiredRecords.length} registros com URLs expiradas encontrados`, 'info');
    return expiredRecords;
  }

  async validateIntegrity(): Promise<ValidationIssue[]> {
    this.log('🔍 Validando integridade...', 'info');

    const records = await prisma.orderItemCustomization.findMany({
      include: { orderItem: true, customization: true },
    });

    const issues: ValidationIssue[] = [];

    for (const record of records) {
      if (!record.orderItem) {
        issues.push({
          recordId: record.id,
          orderItemId: record.order_item_id,
          issue: 'OrderItem referenciado não existe',
          severity: 'error',
          suggested_fix: `Deletar: DELETE FROM OrderItemCustomization WHERE id = '${record.id}'`,
        });
        continue;
      }

      try {
        this.parseCustomizationValue(record.value);
      } catch (e) {
        issues.push({
          recordId: record.id,
          orderItemId: record.order_item_id,
          issue: `Valor JSON inválido: ${String(e).slice(0, 100)}`,
          severity: 'error',
          suggested_fix: `Revisar valor: ${record.value.slice(0, 50)}...`,
        });
      }

      if (record.customization_id && !record.customization) {
        issues.push({
          recordId: record.id,
          orderItemId: record.order_item_id,
          issue: `Customization ${record.customization_id} referenciado não existe`,
          severity: 'warning',
          suggested_fix: `Remover referência ou corrigir customization_id`,
        });
      }
    }

    this.report.validation_issues = issues;
    this.log(`✅ ${issues.length} problemas de integridade encontrados`, 'info');
    return issues;
  }

  async removeDuplicates(duplicates: DuplicateGroup[]): Promise<number> {
    let removed = 0;

    for (const group of duplicates) {
      this.log(
        `🗑️  Removendo ${group.removeIds.length} duplicatas (mantendo ${group.keepId})...`,
        'debug'
      );

      if (!this.dryRun) {
        const deleteResult = await prisma.orderItemCustomization.deleteMany({
          where: { id: { in: group.removeIds } },
        });
        removed += deleteResult.count;
        this.report.cleanup_actions.push(
          `Removidas ${deleteResult.count} duplicatas de: ${group.identity}`
        );
      } else {
        removed += group.removeIds.length;
        this.report.cleanup_actions.push(
          `[DRY-RUN] Removeriam ${group.removeIds.length} duplicatas de: ${group.identity}`
        );
      }
    }

    this.report.records_removed += removed;
    return removed;
  }

  async removeExpiredUrlsFromRecords(
    expiredRecords: { recordId: string; expiredUrls: string[] }[]
  ): Promise<number> {
    let cleaned = 0;

    for (const { recordId, expiredUrls } of expiredRecords) {
      const record = await prisma.orderItemCustomization.findUnique({
        where: { id: recordId },
      });

      if (!record) continue;

      const parsed = this.parseCustomizationValue(record.value);

      const removeUrl = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;

        if (Array.isArray(obj)) {
          for (let i = 0; i < obj.length; i++) {
            if (typeof obj[i] === 'string' && expiredUrls.includes(obj[i])) {
              obj.splice(i, 1);
              i--;
            } else {
              removeUrl(obj[i]);
            }
          }
          return;
        }

        for (const [key, value] of Object.entries(obj)) {
          if (typeof value === 'string' && expiredUrls.includes(value)) {
            delete obj[key];
          } else {
            removeUrl(value);
          }
        }
      };

      removeUrl(parsed);

      if (!this.dryRun) {
        await prisma.orderItemCustomization.update({
          where: { id: recordId },
          data: { value: JSON.stringify(parsed) },
        });
        cleaned++;
        this.report.cleanup_actions.push(
          `Removidas ${expiredUrls.length} URLs expiradas de: ${recordId}`
        );
      } else {
        cleaned++;
        this.report.cleanup_actions.push(
          `[DRY-RUN] Removeriam ${expiredUrls.length} URLs expiradas de: ${recordId}`
        );
      }
    }

    return cleaned;
  }

  async removeInvalidRecords(issues: ValidationIssue[]): Promise<number> {
    let removed = 0;
    const errorRecords = issues.filter((i) => i.severity === 'error').map((i) => i.recordId);

    if (errorRecords.length > 0) {
      if (!this.dryRun) {
        const deleteResult = await prisma.orderItemCustomization.deleteMany({
          where: { id: { in: errorRecords } },
        });
        removed = deleteResult.count;
        this.report.cleanup_actions.push(`Removidos ${removed} registros com integridade ruim`);
      } else {
        removed = errorRecords.length;
        this.report.cleanup_actions.push(
          `[DRY-RUN] Removeriam ${errorRecords.length} registros com integridade ruim`
        );
      }
    }

    return removed;
  }

  async validate(): Promise<CleanupReport> {
    try {
      this.log('=' + '='.repeat(79), 'info');
      this.log('📋 Iniciando validação de customizações...', 'info');
      this.log(`Mode: ${this.dryRun ? 'DRY-RUN (sem mudanças)' : 'LIVE (mudanças ativas)'}`, 'info');
      this.log('=' + '='.repeat(79), 'info');

      const duplicates = await this.findDuplicates();
      if (duplicates.length > 0) {
        await this.removeDuplicates(duplicates);
      }

      const expiredUrls = await this.findExpiredUrls();
      if (expiredUrls.length > 0) {
        await this.removeExpiredUrlsFromRecords(expiredUrls);
      }

      const issues = await this.validateIntegrity();
      if (issues.filter((i) => i.severity === 'error').length > 0) {
        await this.removeInvalidRecords(issues);
      }

      this.log('=' + '='.repeat(79), 'info');
      this.log('📊 RELATÓRIO FINAL', 'info');
      this.log('=' + '='.repeat(79), 'info');
      this.log(`Total de registros verificados: ${this.report.total_records}`, 'info');
      this.log(`Identidades duplicadas encontradas: ${this.report.duplicates_found}`, 'info');
      this.log(`URLs expiradas encontradas: ${this.report.expired_urls}`, 'info');
      this.log(`Registros removidos: ${this.report.records_removed}`, 'info');
      this.log(`Problemas de integridade: ${this.report.validation_issues.length}`, 'info');

      if (this.report.cleanup_actions.length > 0) {
        this.log('\nAções executadas:', 'info');
        this.report.cleanup_actions.forEach((action) => {
          this.log(`  • ${action}`, 'info');
        });
      }

      this.log('=' + '='.repeat(79), 'info');

      if (this.dryRun) {
        this.log(
          '✅ Validação concluída (DRY-RUN). Execute sem --dry-run para aplicar mudanças.',
          'info'
        );
      } else {
        this.log('✅ Validação e limpeza concluídas com sucesso!', 'info');
      }

      return this.report;
    } catch (error) {
      logger.error('❌ Erro durante validação:', error);
      throw error;
    } finally {
      await prisma.$disconnect();
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');

  if (args.includes('--help')) {
    console.log(`
Validador de Customizações de Pedido

Opções:
  --dry-run       Apenas mostra o que seria feito (sem aplicar mudanças)
  --verbose       Mostra logs detalhados
  --help          Mostra esta ajuda

Exemplos:
  npm run validate:customizations -- --dry-run
  npm run validate:customizations -- --dry-run --verbose
  npm run validate:customizations
    `);
    process.exit(0);
  }

  const validator = new OrderCustomizationValidator(dryRun, verbose);
  await validator.validate();
}

main().catch((error) => {
  logger.error('Erro fatal:', error);
  process.exit(1);
});

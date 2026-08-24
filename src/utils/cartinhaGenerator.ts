import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx'

export interface CartinhaOptions {
  message: string
  customerName?: string
}

export async function generateCartinhaBuffer(options: CartinhaOptions): Promise<Buffer> {
  // docx não converte "\n" em quebra de linha — cada linha vira um parágrafo próprio.
  // Sem truncamento: a mensagem vai completa (paginação fica a cargo do Word/viewer).
  const lines = options.message.split('\n')

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: {
            width: 11906,
            height: 16838,
          },
        },
      },
      children: lines.map((line, index) =>
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: index === 0 ? 4000 : 0 },
          children: [
            new TextRun({
              text: line,
              font: 'Arial',
              size: 22, // half-points: 22 = 11pt
            }),
          ],
        }),
      ),
    }],
  })

  return Buffer.from(await Packer.toBuffer(doc))
}

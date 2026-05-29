import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx'

export interface CartinhaOptions {
  message: string
  customerName?: string
}

export async function generateCartinhaBuffer(options: CartinhaOptions): Promise<Buffer> {
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
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 4000 },
          children: [
            new TextRun({
              text: options.message,
              font: 'Times New Roman',
              size: 40,
            }),
          ],
        }),
      ],
    }],
  })

  return Buffer.from(await Packer.toBuffer(doc))
}

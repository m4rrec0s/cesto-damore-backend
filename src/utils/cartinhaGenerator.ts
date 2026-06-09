import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx'

export interface CartinhaOptions {
  message: string
  customerName?: string
  maxLength?: number
}

export async function generateCartinhaBuffer(options: CartinhaOptions): Promise<Buffer> {
  let text = options.message
  if (options.maxLength && text.length > options.maxLength) {
    text = text.slice(0, options.maxLength)
  }

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
              text,
              font: 'Arial',
              size: 22, // half-points: 22 = 11pt
            }),
          ],
        }),
      ],
    }],
  })

  return Buffer.from(await Packer.toBuffer(doc))
}

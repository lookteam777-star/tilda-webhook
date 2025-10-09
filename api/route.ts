import { NextRequest, NextResponse } from 'next/server'
import sgMail from '@sendgrid/mail'

sgMail.setApiKey(process.env.SENDGRID_API_KEY as string)

// утилита: парсим x-www-form-urlencoded
async function parseForm(req: NextRequest) {
  const text = await req.text()
  const params = new URLSearchParams(text)
  const obj: Record<string, string> = {}
  params.forEach((v, k) => (obj[k] = v))
  return obj
}

export async function POST(req: NextRequest) {
  try {
    // 1) проверяем токен
    const { searchParams } = new URL(req.url)
    const token = searchParams.get('token') || ''
    if (token !== (process.env.TILDA_TOKEN || '')) {
      return NextResponse.json({ ok: false, error: 'bad token' }, { status: 401 })
    }

    // 2) читаем тело (Тильда шлёт form-urlencoded)
    const fields = await parseForm(req)

    // 3) аккуратно маппим поля (учтём Daterec/Daterеc c кир. «е»)
    const g = (k: string) => fields[k] || ''
    const date =
      g('Daterec') || g('Daterеc') || g('Date') || g('Datereс') // частые варианты

    const data = {
      first_name:      g('First Name'),
      last_name:       g('Last Name'),
      email:           g('Email'),
      date,
      days:            g('Days'),
      start_time:      g('Start Time'),
      end_time:        g('End Time'),
      delivery_method: g('Delivery') || g('Dostavka'),
      products_text:   g('Products'),
      total:           g('Price') || g('Subtotal')
      // items: [] // если соберёшь массив для красивой таблицы
    }

    // 4) отправляем письмо по Dynamic Template
    const msg = {
      to: data.email || 'test@raskat.rent',
      from: { email: 'info@raskat.rent', name: 'RASKAT RENTAL' },
      templateId: process.env.SENDGRID_TEMPLATE_ID as string,
      dynamic_template_data: data
    }

    await sgMail.send(msg as any)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.response?.body || e?.message || 'send error' },
      { status: 500 }
    )
  }
}

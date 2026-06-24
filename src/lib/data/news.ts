import newsData from '@/data/news.json'
import type { NewsItem } from '@/types'

const news = newsData as NewsItem[]

export function getAllNews(): NewsItem[] {
  return [...news].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}
export function getNewsByTicker(ticker: string): NewsItem[] {
  return news.filter(n => n.affectedTickers.includes(ticker))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}
export function getRecentNews(n = 5): NewsItem[] { return getAllNews().slice(0, n) }

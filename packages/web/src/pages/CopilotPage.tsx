import { useState } from 'react';
import { Send, TrendingUp, MessageSquare, Lightbulb, BarChart3 } from 'lucide-react';
import { api } from '../api/client';

export default function CopilotPage() {
  const [question, setQuestion] = useState('');
  const [response, setResponse] = useState<any>(null);
  const [forecast, setForecast] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<{ q: string; a: string }[]>([]);

  const handleAsk = async () => {
    if (!question.trim()) return;
    setLoading(true);
    try {
      const res = await api.askCopilot(question);
      setResponse(res.data);
      setHistory(prev => [...prev, { q: question, a: res.data.answer }]);
    } catch (e: any) { alert(e.message); }
    setLoading(false);
  };

  const handleForecast = async () => {
    setLoading(true);
    try {
      const res = await api.getForecast();
      setForecast(res.data);
    } catch (e: any) { alert(e.message); }
    setLoading(false);
  };

  const suggestions = [
    'How did we do yesterday?',
    'What are my best-selling products?',
    'What should I reorder?',
    'Which customers haven\'t purchased recently?',
    'Where are my margins declining?',
    'Do I need more employees tomorrow?',
    'What should I promote this week?',
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2 flex items-center gap-2"><MessageSquare size={24} /> AI Business Copilot</h1>
      <p className="text-gray-500 mb-6">Ask natural-language questions about your business and get actionable insights.</p>

      {/* Question input */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAsk()}
            placeholder="Ask anything about your business..."
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={handleAsk} disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
            <Send size={16} /> Ask
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {suggestions.map((s, i) => (
            <button key={i} onClick={() => { setQuestion(s); }} className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs hover:bg-gray-200">
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Response */}
      {response && (
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600"><Lightbulb size={16} /></div>
            <div>
              <div className="font-medium text-gray-900 mb-1">Answer</div>
              <p className="text-gray-700">{response.answer}</p>
            </div>
          </div>
          {response.recommendation && (
            <div className="flex items-start gap-3 mb-4 ml-11">
              <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-600"><TrendingUp size={16} /></div>
              <div>
                <div className="font-medium text-gray-900 mb-1">Recommendation</div>
                <p className="text-gray-700">{response.recommendation}</p>
              </div>
            </div>
          )}
          {response.action && (
            <div className="ml-11 mt-2">
              <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium">
                Suggested Action: {response.action.type}
              </span>
            </div>
          )}
          {response.metrics && Object.keys(response.metrics).length > 0 && (
            <div className="ml-11 mt-4 bg-gray-50 rounded-lg p-4">
              <div className="text-sm font-medium text-gray-600 mb-2">Supporting Metrics</div>
              <pre className="text-xs text-gray-500 overflow-auto">{JSON.stringify(response.metrics, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      {/* Forecast */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold flex items-center gap-2"><BarChart3 size={18} /> 7-Day Revenue Forecast</h2>
          <button onClick={handleForecast} disabled={loading} className="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
            Generate Forecast
          </button>
        </div>
        {forecast && (
          <div>
            <div className="text-sm text-gray-500 mb-3">Based on 30-day average: <span className="font-medium text-gray-900">${forecast.historicalAvg}/day</span></div>
            <div className="grid grid-cols-7 gap-2">
              {forecast.forecast.map((f: any, i: number) => (
                <div key={i} className="bg-gray-50 rounded-lg p-2 text-center">
                  <div className="text-xs text-gray-500">{new Date(f.date).toLocaleDateString('en-US', { weekday: 'short' })}</div>
                  <div className="text-sm font-bold text-blue-600">${f.predictedRevenue}</div>
                  <div className="text-xs text-gray-400">{f.confidence}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-sm text-gray-600">Total predicted: <span className="font-bold">${forecast.totalPredicted}</span></div>
          </div>
        )}
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold mb-4">Conversation History</h2>
          <div className="space-y-4">
            {history.map((h, i) => (
              <div key={i} className="border-b pb-3 last:border-0">
                <div className="text-sm font-medium text-gray-900">Q: {h.q}</div>
                <div className="text-sm text-gray-600 mt-1">A: {h.a}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

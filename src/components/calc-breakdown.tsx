import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCalcDebug } from '@/lib/calc-debug';
import { formatMoney } from '@/lib/money';

export type CalcBreakdownStep = {
  label: string;
  formula?: string;
  value: number | string;
  emphasis?: boolean;
};

export async function CalcBreakdown({
  title = 'Calculation breakdown',
  steps,
}: {
  title?: string;
  steps: CalcBreakdownStep[];
}) {
  const debug = await getCalcDebug();
  if (!debug) return null;

  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <CardHeader>
        <CardTitle className="text-amber-900">🔍 {title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        <p className="text-xs text-slate-600 mb-3">
          Demo-only debug view. Verify these intermediate values against your
          broker entry summary or accounting system before relying on them.
        </p>
        <table className="w-full text-sm">
          <tbody>
            {steps.map((s, i) => (
              <tr
                key={i}
                className={`border-b border-amber-100 last:border-0 ${
                  s.emphasis ? 'font-semibold text-slate-900' : 'text-slate-700'
                }`}
              >
                <td className="py-2 pr-3 align-top">
                  <div>{s.label}</div>
                  {s.formula && (
                    <div className="font-mono text-xs text-slate-500 mt-0.5">
                      {s.formula}
                    </div>
                  )}
                </td>
                <td className="py-2 text-right tabular-nums whitespace-nowrap">
                  {typeof s.value === 'number' ? formatMoney(s.value) : s.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

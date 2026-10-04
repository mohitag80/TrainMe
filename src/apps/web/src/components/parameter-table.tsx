import type { ReactNode } from 'react';
import type { EffectiveParameter } from '@trainme/schema';
import { conditionLabel, groupParameters, humanize, inputLabel, rangeLabel, type ParamRow } from '@/lib/labels';

/**
 * What an activity records, in plain words. Skill pairs (attempted → accurate) are one row; columns have
 * fixed widths so every activity's table lines up. `unitCell`/`actions` let the tracker page add controls.
 */
export function ParameterTable({
  params,
  unitCell,
  actions,
}: {
  params: EffectiveParameter[];
  unitCell?: (p: EffectiveParameter) => ReactNode;
  actions?: (row: ParamRow) => ReactNode;
}) {
  const rows = groupParameters(params);
  if (rows.length === 0) return <p className="muted small">Nothing to record yet.</p>;
  return (
    <div className="table-wrap">
      <table className="ptable">
        <colgroup>
          <col style={{ width: actions ? '34%' : '40%' }} />
          <col style={{ width: actions ? '34%' : '42%' }} />
          <col style={{ width: actions ? '14%' : '18%' }} />
          {actions && <col style={{ width: '18%' }} />}
        </colgroup>
        <thead>
          <tr>
            <th>What you record</th>
            <th>How</th>
            <th>Unit</th>
            {actions && <th className="right">Options</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) =>
            row.kind === 'skill' ? (
              <tr key={row.attempted.key}>
                <td>
                  <div className="pname">{row.name}</div>
                  <div className="phint">Off unless you try it</div>
                </td>
                <td>
                  <div>Switch on when attempted</div>
                  <div className="phint">then mark Accurate or Missed</div>
                </td>
                <td className="muted">–</td>
                {actions && <td className="right">{actions(row)}</td>}
              </tr>
            ) : (
              <tr key={row.param.key}>
                <td>
                  <div className="pname">
                    {row.param.label}
                    {row.param.custom && <span className="tag tag-ok">yours</span>}
                    {row.param.required && row.param.type !== 'BOOL' && <span className="tag">required</span>}
                  </div>
                  {row.param.condition && <div className="phint">{conditionLabel(row.param, params)}</div>}
                  {row.param.description && <div className="phint">{row.param.description}</div>}
                </td>
                <td>
                  <div>
                    {inputLabel(row.param)}
                    {rangeLabel(row.param) && <span className="muted"> · {rangeLabel(row.param)}</span>}
                  </div>
                  {row.param.type === 'ENUM' && (
                    <div className="phint">{(row.param.constraints.options ?? []).map(humanize).join(' · ')}</div>
                  )}
                </td>
                <td>{unitCell ? unitCell(row.param) : (row.param.unit ?? <span className="muted">–</span>)}</td>
                {actions && <td className="right">{actions(row)}</td>}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

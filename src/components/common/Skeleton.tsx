import React from 'react';

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

export function TableSkeleton({ rows = 10, columns = 6 }: TableSkeletonProps) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          {Array.from({ length: columns }).map((_, i) => (
            <th key={i}>
              <div className="skeleton" style={{ height: 14, width: 80 }} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r}>
            {Array.from({ length: columns }).map((_, c) => (
              <td key={c}>
                <div className="skeleton" style={{
                  height: 12,
                  width: c === 0 ? 120 : c === columns - 1 ? 60 : 80,
                }} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

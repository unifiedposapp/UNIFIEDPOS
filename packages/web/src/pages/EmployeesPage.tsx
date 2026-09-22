import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Users, Clock, Play, Square } from 'lucide-react';

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [timeEntries, setTimeEntries] = useState<any[]>([]);

  const load = async () => {
    const res = await api.getEmployees();
    setEmployees(res.data || []);
  };

  const loadDetail = async (id: string) => {
    const [empRes, timeRes] = await Promise.all([
      api.getEmployee(id),
      api.getEmployeeTimeEntries(id),
    ]);
    setSelected(empRes.data);
    setTimeEntries(timeRes.data || []);
  };

  useEffect(() => { load(); }, []);

  const clockAction = async (id: string, action: string) => {
    await api.clockEmployee(id, action);
    loadDetail(id);
  };

  const getActiveEntry = () => {
    return timeEntries.find((e: any) => !e.clockOut);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Employee Management</h1>
        <p className="text-gray-500">Manage employees, time tracking, and schedules</p>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-1">
          <div className="bg-white rounded-lg border">
            <div className="p-4 border-b flex items-center gap-2">
              <Users size={18} />
              <h2 className="font-semibold">Employees ({employees.length})</h2>
            </div>
            <div className="divide-y max-h-[600px] overflow-y-auto">
              {employees.map(emp => (
                <div
                  key={emp.id}
                  onClick={() => loadDetail(emp.id)}
                  className={`p-4 cursor-pointer hover:bg-gray-50 ${selected?.id === emp.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''}`}
                >
                  <div className="font-medium">{emp.user?.name}</div>
                  <div className="text-sm text-gray-500">{emp.user?.email}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">{emp.user?.role}</span>
                    {emp.department && <span className="text-xs text-gray-400">{emp.department}</span>}
                    <span className={`text-xs px-2 py-0.5 rounded ${emp.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {emp.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-2 space-y-4">
          {selected ? (
            <>
              <div className="bg-white rounded-lg border p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-bold">{selected.user?.name}</h2>
                    <p className="text-gray-500">{selected.position} | {selected.department}</p>
                    <p className="text-sm text-gray-400">Employee #{selected.employeeNumber}</p>
                  </div>
                  <div className="flex gap-2">
                    {!getActiveEntry() ? (
                      <button onClick={() => clockAction(selected.id, 'CLOCK_IN')} className="flex items-center gap-1 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
                        <Play size={16} /> Clock In
                      </button>
                    ) : (
                      <>
                        <button onClick={() => clockAction(selected.id, 'BREAK_START')} className="flex items-center gap-1 bg-yellow-500 text-white px-3 py-2 rounded hover:bg-yellow-600 text-sm">
                          Break
                        </button>
                        <button onClick={() => clockAction(selected.id, 'CLOCK_OUT')} className="flex items-center gap-1 bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700">
                          <Square size={16} /> Clock Out
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="bg-gray-50 rounded p-3">
                    <div className="text-gray-500">Hourly Rate</div>
                    <div className="font-bold text-lg">${selected.hourlyRate ? Number(selected.hourlyRate).toFixed(2) : '0.00'}/hr</div>
                  </div>
                  <div className="bg-gray-50 rounded p-3">
                    <div className="text-gray-500">Locations</div>
                    <div className="font-bold text-lg">{selected.locations?.length || 0}</div>
                  </div>
                  <div className="bg-gray-50 rounded p-3">
                    <div className="text-gray-500">Recent Orders</div>
                    <div className="font-bold text-lg">{selected.orders?.length || 0}</div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg border p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4"><Clock size={18} /> Time Entries</h3>
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-start px-4 py-2 text-sm">Clock In</th>
                      <th className="text-start px-4 py-2 text-sm">Break</th>
                      <th className="text-start px-4 py-2 text-sm">Clock Out</th>
                      <th className="text-end px-4 py-2 text-sm">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeEntries.map((entry: any) => {
                      const duration = entry.clockOut
                        ? ((new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime()) / 3600000).toFixed(1) + 'h'
                        : 'Active';
                      return (
                        <tr key={entry.id} className="border-b">
                          <td className="px-4 py-2 text-sm">{new Date(entry.clockIn).toLocaleString()}</td>
                          <td className="px-4 py-2 text-sm">
                            {entry.breakStart ? new Date(entry.breakStart).toLocaleTimeString() : '-'}
                            {entry.breakEnd ? ` - ${new Date(entry.breakEnd).toLocaleTimeString()}` : ''}
                          </td>
                          <td className="px-4 py-2 text-sm">{entry.clockOut ? new Date(entry.clockOut).toLocaleString() : '-'}</td>
                          <td className="px-4 py-2 text-sm text-end">{duration}</td>
                        </tr>
                      );
                    })}
                    {timeEntries.length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500">No time entries</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="bg-white rounded-lg border p-12 text-center text-gray-500">
              Select an employee to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

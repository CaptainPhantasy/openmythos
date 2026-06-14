import { useState, useEffect, useCallback } from 'react';

interface PromptInfo {
	name: string;
	content: string;
}

interface AgentPromptEditorProps {
	className?: string;
}

export default function AgentPromptEditor({ className = '' }: AgentPromptEditorProps) {
	const [prompts, setPrompts] = useState<string[]>([]);
	const [selected, setSelected] = useState<PromptInfo | null>(null);
	const [editContent, setEditContent] = useState('');
	const [dirty, setDirty] = useState(false);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	const fetchPrompts = useCallback(async () => {
		try {
			const res = await fetch('/api/v1/mcp/agent-prompts');
			const data = await res.json();
			setPrompts(data.prompts || []);
		} catch (err) {
			console.error('Failed to fetch prompts:', err);
		}
	}, []);

	useEffect(() => {
		fetchPrompts();
	}, [fetchPrompts]);

	const loadPrompt = async (name: string) => {
		if (dirty && selected) {
			if (!window.confirm('Unsaved changes will be lost. Continue?')) return;
		}
		try {
			const res = await fetch(`/api/v1/mcp/agent-prompts/${name}`);
			const data = await res.json();
			setSelected({ name: data.name, content: data.content });
			setEditContent(data.content);
			setDirty(false);
			setMessage(null);
		} catch (err) {
			setMessage(`Error loading prompt: ${err}`);
		}
	};

	const savePrompt = async () => {
		if (!selected) return;
		setSaving(true);
		try {
			const res = await fetch(`/api/v1/mcp/agent-prompts/${selected.name}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: editContent }),
			});
			if (res.ok) {
				setDirty(false);
				setMessage(`✓ Saved ${selected.name}`);
				setSelected({ ...selected, content: editContent });
			} else {
				setMessage('Failed to save');
			}
		} catch (err) {
			setMessage(`Error: ${err}`);
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className={`flex flex-col h-full ${className}`}>
			<div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700">
				<span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
					Agent Prompts
				</span>
				<span className="text-xs text-gray-500">
					Historical prompt backups are quarantined under docs/_quarantine/.
				</span>
			</div>

			<div className="flex flex-1 overflow-hidden">
				{/* Prompt list */}
				<div className="w-56 border-r border-gray-700 overflow-y-auto bg-gray-900/50">
					{prompts.map((name) => (
						<button
							key={name}
							onClick={() => loadPrompt(name)}
							className={`w-full text-left px-3 py-2 text-xs font-mono truncate transition-colors ${
								selected?.name === name
									? 'bg-primary-500/20 text-primary-300'
									: 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
							}`}
						>
							{name}
						</button>
					))}
				</div>

				{/* Editor */}
				<div className="flex-1 flex flex-col">
					{selected ? (
						<>
							<div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700 bg-gray-800/50">
								<span className="text-sm font-mono text-gray-300">{selected.name}</span>
								<div className="flex items-center space-x-2">
									{dirty && (
										<span className="text-xs text-yellow-400">● Modified</span>
									)}
									<button
										onClick={savePrompt}
										disabled={!dirty || saving}
										className="px-3 py-1 text-xs bg-primary-500 text-white rounded hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
									>
										{saving ? 'Saving...' : 'Save'}
									</button>
									<button
										onClick={() => {
											setEditContent(selected.content);
											setDirty(false);
										}}
										className="px-3 py-1 text-xs text-gray-400 hover:text-white rounded border border-gray-600 hover:border-gray-500 transition-colors"
									>
										Reset
									</button>
								</div>
							</div>
							<textarea
								value={editContent}
								onChange={(e) => {
									setEditContent(e.target.value);
									setDirty(true);
								}}
								className="flex-1 w-full p-3 bg-gray-900 text-gray-200 text-sm font-mono resize-none focus:outline-none"
								spellCheck={false}
							/>
						</>
					) : (
						<div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
							Select a prompt from the list to edit
						</div>
					)}

					{message && (
						<div className="px-3 py-2 text-xs text-gray-300 bg-gray-800 border-t border-gray-700">
							{message}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

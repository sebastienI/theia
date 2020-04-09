/********************************************************************************
 * Copyright (C) 2018 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import '../../src/browser/style/output.css';
import * as React from 'react';
import { inject, injectable, postConstruct } from 'inversify';
import { toArray } from '@phosphor/algorithm';
import { IDragEvent } from '@phosphor/dragdrop';
import { Message, BaseWidget, ReactWidget, Widget, MessageLoop, DockPanel } from '@theia/core/lib/browser';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { OutputChannelManager, OutputChannel } from '../common/output-channel';

@injectable()
export class OutputWidget extends BaseWidget {

    static readonly ID = 'outputView';

    @inject(OutputChannelManager)
    protected readonly outputChannelManager: OutputChannelManager;

    protected readonly channelsContainer: DockPanel;

    constructor() {
        super();
        this.id = OutputWidget.ID;
        this.title.label = 'Output';
        this.title.caption = 'Output';
        this.title.iconClass = 'fa fa-flag';
        this.title.closable = true;
        this.addClass('theia-output');
        this.node.tabIndex = 0;
        this.channelsContainer = new NoDropTargetDockPanel({ spacing: 0, mode: 'single-document' });
        this.channelsContainer.addClass('channels-container');
        this.channelsContainer.node.tabIndex = -1;
    }

    @postConstruct()
    protected init(): void {
        for (const channel of this.outputChannelManager.getChannels()) {
            this.addChannel(channel);
        }
        this.toDispose.pushAll([
            this.outputChannelManager.onChannelAdded(this.addChannel.bind(this)),
            this.outputChannelManager.onChannelDelete(this.removeChannel.bind(this)),
            this.outputChannelManager.onSelectedChannelChange(() => {
                if (this.selectedChannelWidget) {
                    this.channelsContainer.selectWidget(this.selectedChannelWidget);
                }
            })
        ]);
    }

    protected onAfterAttach(message: Message): void {
        super.onAfterAttach(message);
        Widget.attach(this.channelsContainer, this.node);
        this.toDisposeOnDetach.push(Disposable.create(() => Widget.detach(this.channelsContainer)));
    }

    protected onActivateRequest(message: Message): void {
        super.onActivateRequest(message);
        if (this.selectedChannelWidget) {
            MessageLoop.sendMessage(this.selectedChannelWidget, Widget.Msg.ActivateRequest);
        } else {
            this.node.focus();
        }
    }

    protected onResize(message: Widget.ResizeMessage): void {
        super.onResize(message);
        MessageLoop.sendMessage(this.channelsContainer, Widget.ResizeMessage.UnknownSize);
        for (const widget of toArray(this.channelsContainer.widgets())) {
            MessageLoop.sendMessage(widget, Widget.ResizeMessage.UnknownSize);
        }
    }

    protected addChannel(channel: OutputChannel): void {
        this.channelsContainer.addWidget(new OutputChannelWidget({ channel }));
        this.update();
    }

    protected removeChannel({ channelName: name }: { channelName: string }): void {
        const widget = this.getChannelWidget(name);
        if (!widget) {
            console.warn(`Nothing to do. Could not find widget for output channel '${name}.'`);
        } else {
            widget.close();
        }
        this.update();
    }

    clear(): void {
        if (this.selectedChannel) {
            this.selectedChannel.clear();
        }
    }

    selectAll(): void {
        if (this.selectedChannelWidget) {
            const element = this.selectedChannelWidget.node;
            if (element) {
                element.focus();
                const selection = window.getSelection();
                if (selection) {
                    const range = document.createRange();
                    range.selectNodeContents(element);
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
            }
        }
    }

    private get selectedChannel(): OutputChannel | undefined {
        return this.outputChannelManager.selectedChannel;
    }

    private getChannelWidget(name: string): OutputChannelWidget | undefined {
        for (const widget of toArray(this.channelsContainer.widgets())) {
            if (widget instanceof OutputChannelWidget) {
                if (widget.channel.name === name) {
                    return widget;
                }
            }
        }
        return undefined;
    }

    private get selectedChannelWidget(): OutputChannelWidget | undefined {
        if (this.selectedChannel) {
            const { name } = this.selectedChannel;
            return this.getChannelWidget(name);
        }
        return undefined;
    }

}

/**
 * Customized `DockPanel` that does not allow dropping widgets into it.
 */
class NoDropTargetDockPanel extends DockPanel {

    constructor(options?: DockPanel.IOptions) {
        super(options);
        NoDropTargetDockPanel.prototype['_evtDrop'] = (event: IDragEvent) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (event as any).proposedAction = 'none';
            super['_evtDrop'](event);
        };
    }
}

class OutputChannelWidget extends ReactWidget {

    constructor(protected readonly options: Widget.IOptions & { channel: OutputChannel }) {
        super(options);
        this.id = `output-channel-widget--${this.name}`;
        this.node.tabIndex = 0;
        this.addClass('output-channel-widget');
        this.toDispose.push(new DisposableCollection(
            this.channel.onContentChange(() => this.update())
        ));
    }

    protected onAfterAttach(message: Message): void {
        super.onAfterAttach(message);
        this.update();
    }

    protected onResize(message: Widget.ResizeMessage): void {
        super.onResize(message);
        this.update();
    }

    protected onUpdateRequest(message: Message): void {
        super.onUpdateRequest(message);
        if (!this.channel.isLocked) {
            setTimeout(() => {
                const anchor = this.anchor;
                if (anchor) {
                    anchor.scrollIntoView(false);
                }
            }, 1);
        }
    }

    protected onActivateRequest(message: Message): void {
        super.onActivateRequest(message);
        const anchor = this.anchor;
        if (anchor && !this.channel.isLocked) {
            anchor.focus();
        } else {
            this.node.focus();
        }
    }

    protected render(): React.ReactNode {
        const lines = [];
        let id = 0;
        const style: React.CSSProperties = {
            whiteSpace: 'pre',
            fontFamily: 'monospace',
        };
        for (const text of this.channel.getLines()) {
            for (const content of text.split(/[\n\r]+/) || []) {
                lines.push(<div style={style} key={`${this.name}-${id++}`}>{content}</div>);
            }
        }
        if (lines.length === 0) {
            lines.push(<div style={style} key={`${this.name}-${id++}`}>{'<no output yet>'}</div>);
        }
        const anchor = <div id={this.anchorId} tabIndex={0} />;
        return <div>
            {lines}
            {anchor}
        </div>;
    }

    get channel(): OutputChannel {
        return this.options.channel;
    }

    get name(): string {
        return this.channel.name;
    }

    private get anchorId(): string {
        return `output-channel-${this.name}-anchor`;
    }

    private get anchor(): HTMLElement | undefined {
        const anchor = document.getElementById(this.anchorId);
        if (anchor) {
            return anchor;
        }
        return undefined;
    }

}

/**
 * @deprecated Use `OutputWidget.ID` instead.
 */
export const OUTPUT_WIDGET_KIND = OutputWidget.ID;

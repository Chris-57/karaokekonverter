#!/usr/bin/env python3
"""AWS CLI operations for the existing stack; no SDK or stored credentials needed."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import tempfile
import time
import uuid


class Aws:
    def __init__(self, region):
        self.region = region

    def __call__(self, *args):
        command = ['aws', *args, '--region', self.region, '--output', 'json', '--no-cli-pager',
                   '--cli-connect-timeout', '10', '--cli-read-timeout', '30']
        result = subprocess.run(command, capture_output=True, text=True, timeout=45, check=False)
        if result.returncode:
            raise RuntimeError(f"AWS {args[0]} {args[1]} failed: {result.stderr.strip()[:500]}")
        return json.loads(result.stdout or '{}')


def stack_outputs(aws, stack):
    value = aws('cloudformation', 'describe-stacks', '--stack-name', stack)['Stacks'][0]
    if value['StackStatus'] not in ['CREATE_COMPLETE', 'UPDATE_COMPLETE']:
        raise RuntimeError(f"Stack is {value['StackStatus']}; finish or investigate the update first.")
    outputs = {entry['OutputKey']: entry['OutputValue'] for entry in value.get('Outputs', [])}
    if 'MonitoringTestAlarmName' not in outputs:
        raise RuntimeError('Monitoring outputs are missing. Deploy version 0.3.0 first.')
    return outputs


def alarm_status(aws, name):
    alarms = aws('cloudwatch', 'describe-alarms', '--alarm-names', name).get('MetricAlarms', [])
    if len(alarms) != 1:
        raise RuntimeError('The monitoring test alarm could not be found.')
    if not alarms[0].get('ActionsEnabled', False):
        raise RuntimeError('Alarm actions are disabled. Enable them before testing notifications.')
    return alarms[0]


def wait_for_alarm(aws, name, expected, timeout, sleep=time.sleep, clock=time.monotonic):
    deadline = clock() + timeout
    previous = None
    while clock() < deadline:
        alarm = alarm_status(aws, name)
        state = alarm['StateValue']
        if state != previous:
            print(f'Test alarm: {state}; waiting for {expected}.', flush=True)
            previous = state
        if state == expected:
            return alarm
        sleep(10)
    raise RuntimeError(f'Timed out waiting for {expected}. Inspect alarm history and monitoring logs; do not redeploy the stack to retry a test.')


def stamp(value):
    if isinstance(value, (int, float)):
        return value / 1000 if value > 100000000000 else value
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def matching_action(item, alarm, topic):
    try:
        data = json.loads(item['HistoryData'])
        if data.get('notificationResource') != topic:
            return None
        # Tie the action to the exact state transition we observed, not an old
        # successful publish or another alarm's notification.
        if abs(stamp(data['stateUpdateTimestamp']) - stamp(alarm.get('StateTransitionedTimestamp', alarm['StateUpdatedTimestamp']))) > 1:
            return None
        return data.get('actionState')
    except (KeyError, TypeError, ValueError):
        return None


def wait_for_action(aws, name, alarm, topic, timeout, sleep=time.sleep, clock=time.monotonic):
    deadline = clock() + timeout
    while clock() < deadline:
        history = aws('cloudwatch', 'describe-alarm-history', '--alarm-name', name,
                      '--history-item-type', 'Action', '--start-date', alarm.get('StateTransitionedTimestamp', alarm['StateUpdatedTimestamp']))
        states = [matching_action(item, alarm, topic) for item in history.get('AlarmHistoryItems', [])]
        if 'Succeeded' in states:
            return {'state': alarm['StateValue'], 'transitionedAt': alarm.get('StateTransitionedTimestamp', alarm['StateUpdatedTimestamp']), 'snsPublish': 'Succeeded'}
        if 'Failed' in states:
            raise RuntimeError('CloudWatch could not publish the notification to SNS. Inspect the alarm Action history and topic policy.')
        sleep(10)
    raise RuntimeError('The alarm changed state, but a successful SNS action for that transition was not verified. Inspect alarm Action history.')


def invoke(aws, function, event):
    with tempfile.TemporaryDirectory(prefix='karaoke-monitoring-') as folder:
        payload = Path(folder) / 'event.json'
        response = Path(folder) / 'response.json'
        payload.write_text(json.dumps(event), encoding='utf-8')
        metadata = aws('lambda', 'invoke', '--function-name', function, '--invocation-type', 'RequestResponse',
                       '--payload', 'fileb://' + str(payload), str(response))
        if metadata.get('FunctionError') or metadata.get('StatusCode') != 200:
            raise RuntimeError('Monitoring Lambda invocation failed. Check its log group.')
        return json.loads(response.read_text(encoding='utf-8'))


def subscriptions(aws, outputs):
    items = aws('sns', 'list-subscriptions-by-topic', '--topic-arn', outputs['AlertTopicArn']).get('Subscriptions', [])
    return sum(entry.get('Protocol') == 'email' and entry.get('SubscriptionArn', '').startswith('arn:') for entry in items)


def exercise(aws, outputs, timeout=600, call=invoke, wait=wait_for_alarm, action=wait_for_action):
    topic = outputs['AlertTopicArn']
    name = outputs['MonitoringTestAlarmName']
    function = outputs['MonitoringFunctionName']
    if not subscriptions(aws, outputs):
        raise RuntimeError('No confirmed email subscription was found for this stack topic.')
    current = alarm_status(aws, name)
    if topic not in current.get('AlarmActions', []) or topic not in current.get('OKActions', []):
        raise RuntimeError('The test alarm is not wired to this topic for both ALARM and OK.')
    test_id = str(uuid.uuid4())
    report = {'testId': test_id, 'alarm': name, 'emailReceipt': 'Confirm in your inbox; AWS action success does not prove email delivery.'}
    print('This sends a controlled ALARM email and an OK recovery email. An initial OK email may also arrive.', flush=True)
    try:
        call(aws, function, {'operation': 'alarm-test', 'signal': 0, 'testId': test_id})
        wait(aws, name, 'OK', timeout)
        call(aws, function, {'operation': 'alarm-test', 'signal': 1, 'testId': test_id})
        transition = wait(aws, name, 'ALARM', timeout)
        report['alarmAction'] = action(aws, name, transition, topic, min(timeout, 180))
    finally:
        # Attempt reset even after timeout, failed SNS delivery or Ctrl+C.
        print('Sending the isolated test reset (signal=0).', flush=True)
        call(aws, function, {'operation': 'alarm-test', 'signal': 0, 'testId': test_id})
    transition = wait(aws, name, 'OK', timeout)
    report['recoveryAction'] = action(aws, name, transition, topic, min(timeout, 180))
    report['result'] = 'Metric-to-alarm-to-SNS publish verified for ALARM and recovery.'
    return report


def verify_filters(aws, outputs):
    outcome = {'event': 'conversion_finished', 'outcome': 1, 'completedJobs': 1, 'partialJobs': 0, 'failedJobs': 0, 'operationalFailure': 0, 'tracks': 2, 'matched': 2, 'elapsedMs': 100}
    samples = {
        'CompletedJobs': outcome, 'PartialJobs': outcome, 'FailedJobs': outcome, 'JobDurationMs': outcome,
        'SourceTracks': outcome, 'MatchedTracks': outcome,
        'QueueWaitMs': {'event': 'conversion_started', 'queueWaitMs': 10},
        'OperationalFailures': {'event': 'worker_infrastructure_failed', 'operationalFailure': 1},
        'AvailabilityFailures': {'event': 'availability_checked', 'availabilityFailure': 1},
        'MonitoringTestFailures': {'event': 'monitoring_test', 'testFailure': 1}
    }
    verified = []
    for group_key in ['ApiLogGroup', 'WorkerLogGroup', 'MonitoringLogGroup']:
        filters = aws('logs', 'describe-metric-filters', '--log-group-name', outputs[group_key]).get('metricFilters', [])
        for rule in filters:
            transform = rule['metricTransformations'][0]
            if transform['metricNamespace'] != outputs['MonitoringNamespace']:
                continue
            metric = transform['metricName']
            sample = samples[metric]
            result = aws('logs', 'test-metric-filter', '--filter-pattern', rule['filterPattern'], '--log-event-messages', json.dumps([json.dumps(sample), '{"event":"unrelated"}']))
            if len(result.get('matches', [])) != 1 or result['matches'][0].get('eventMessage') != json.dumps(sample):
                raise RuntimeError(f'Metric filter verification failed for {metric}.')
            if transform['metricValue'].startswith('$.') and transform['metricValue'][2:] not in sample:
                raise RuntimeError(f'Metric extraction field is missing for {metric}.')
            verified.append(metric)
    if len(verified) != 11 or set(verified) != set(samples):
        raise RuntimeError('Expected all 11 filters publishing 10 distinct custom metrics; inspect the deployed template.')
    return {'verifiedFilters': len(verified), 'distinctMetrics': len(set(verified)), 'note': 'AWS filter syntax checked with samples; no log events or alarm metrics were published.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['status', 'check', 'verify-filters', 'test', 'reset-test'])
    parser.add_argument('--stack', default='karaokekonverter-dev')
    parser.add_argument('--region', default='us-east-2')
    parser.add_argument('--timeout', type=int, default=600, help='Maximum seconds per alarm state wait (120–1200).')
    parser.add_argument('--report', type=Path, help='Write a credential-free JSON result.')
    args = parser.parse_args()
    if not 120 <= args.timeout <= 1200:
        parser.error('--timeout must be between 120 and 1200 seconds')
    aws = Aws(args.region)
    try:
        outputs = stack_outputs(aws, args.stack)
        if args.operation == 'status':
            alarms = aws('cloudwatch', 'describe-alarms', '--alarm-names', *outputs['MonitoringAlarmNames'].split(',')).get('MetricAlarms', [])
            result = {'dashboard': outputs['MonitoringDashboardUrl'], 'confirmedEmailSubscriptions': subscriptions(aws, outputs),
                      'alarms': [{'name': a['AlarmName'], 'state': a['StateValue'], 'actionsEnabled': a['ActionsEnabled'], 'reason': a['StateReason']} for a in alarms]}
        elif args.operation == 'verify-filters':
            result = verify_filters(aws, outputs)
        elif args.operation == 'test':
            result = exercise(aws, outputs, args.timeout)
        else:
            event = {'operation': 'check'} if args.operation == 'check' else {'operation': 'alarm-test', 'signal': 0, 'testId': str(uuid.uuid4())}
            result = invoke(aws, outputs['MonitoringFunctionName'], event)
            if args.operation == 'check' and result.get('healthy') is not True:
                raise RuntimeError('Availability check failed: ' + json.dumps(result))
        result.update({'stack': args.stack, 'region': args.region, 'checkedAt': datetime.now(timezone.utc).isoformat()})
        print(json.dumps(result, indent=2))
        if args.report:
            args.report.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        return 0
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        print(f'Monitoring check failed: {error}')
        print('If a test was interrupted, run: python3 scripts/monitoring.py reset-test')
        return 1
    except KeyboardInterrupt:
        print('\nInterrupted. If needed, run: python3 scripts/monitoring.py reset-test')
        return 130


if __name__ == '__main__':
    raise SystemExit(main())
